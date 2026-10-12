import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createChatTools,
  createIngestTools,
  createProfileTools,
  type Repos,
} from "@narnia-jobs/core";
import {
  CHAT_TOOL_JSON_SCHEMAS,
  CHAT_TOOLS,
  type ChatCategory,
  INGEST_TOOL_JSON_SCHEMAS,
  INGEST_TOOLS,
  PROFILE_TOOL_JSON_SCHEMAS,
  PROFILE_TOOLS,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { IngestionStartDeps } from "../routes/ingestions";
import { createChatIngestPort } from "./ingest-port";
import { inScope, publishedName } from "./scopes";

/** Erro das tools do servidor (fora do escopo, execução de outra sessão, tool inexistente). */
class McpToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: unknown) => Promise<unknown>;
}

type SchemaMap = Record<string, { input: Record<string, unknown> }>;
type Definitions = Record<string, { description: string }>;

function entries(
  defs: Definitions,
  schemas: SchemaMap,
  handlers: Record<string, (input: unknown) => unknown>,
): ToolEntry[] {
  return Object.keys(defs).map((name) => ({
    name,
    description: defs[name]?.description ?? name,
    inputSchema: (schemas[name]?.input ?? { type: "object" }) as Record<string, unknown>,
    call: async (args) => (handlers[name] as (input: unknown) => unknown)(args),
  }));
}

/** Registro único das tools (F04 §2.2): perfil (F02), arquivos e ingestão (F03) e as da conversa (F04). */
function registry(deps: IngestionStartDeps, sessionId: string | null): Map<string, ToolEntry> {
  const all = [
    ...entries(
      PROFILE_TOOLS,
      PROFILE_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createProfileTools(deps.repos),
    ),
    ...entries(
      INGEST_TOOLS,
      INGEST_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createIngestTools(deps.repos, { dataDir: deps.dataDir }),
    ),
    ...entries(
      CHAT_TOOLS,
      CHAT_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createChatTools(deps.repos, { ingest: createChatIngestPort(deps), sessionId }),
    ),
  ];
  return new Map(all.map((t) => [publishedName(t.name), t]));
}

const isZodError = (e: unknown): e is { issues: Array<{ path: PropertyKey[]; message: string }> } =>
  typeof e === "object" && e !== null && Array.isArray((e as { issues?: unknown }).issues);

/** Erro como `isError`: `[código] mensagem` em pt-BR (tools tipadas) ou `invalid_input` / `internal`. */
export function toolErrorText(e: unknown): string {
  if (isZodError(e)) {
    const detail = e.issues
      .map((i) => `${i.path.map(String).join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    return `[invalid_input] Entrada inválida: ${detail}`;
  }
  const code = (e as { code?: unknown }).code;
  const message = (e as Error).message ?? String(e);
  if (typeof code === "string") return `[${code}] ${message}`;
  return `[internal] Falha ao executar a ferramenta: ${message}`;
}

function buildServer(deps: IngestionStartDeps, version: string, session: SessionInfo) {
  const tools = registry(deps, session.id);
  const visible = [...tools.entries()].filter(([, t]) => inScope(t.name, session.category));
  const server = new Server({ name: "narnia-jobs", version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visible.map(([published, t]) => ({
      name: published,
      description: t.description,
      inputSchema: { type: "object", ...t.inputSchema } as { type: "object" },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const tool = tools.get(req.params.name);
      if (!tool)
        throw new McpToolError("tool_not_found", `Ferramenta inexistente: ${req.params.name}`);
      if (!inScope(tool.name, session.category))
        throw new McpToolError(
          "tool_not_in_scope",
          `A ferramenta ${req.params.name} não está disponível nesta conversa (${session.category ?? "terminal"}).`,
        );
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      if (
        tool.name === "ingest.propose" &&
        session.category === "clarify" &&
        args.runId !== session.runId
      )
        throw new McpToolError(
          "run_not_in_session",
          "Esta conversa de clarificação só pode propor correções para a própria ingestão.",
        );
      const out = await tool.call(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(out) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: toolErrorText(e) }] };
    }
  });
  return server;
}

interface SessionInfo {
  id: string | null;
  category: ChatCategory | null;
  runId: string | null;
}

/**
 * Servidor MCP em `/mcp` (F04 §2.2, F04-7, F04-11): SDK oficial, transporte HTTP no padrão web, sem estado entre
 * requisições (cada uma monta servidor + transporte com o escopo da sessão). O token de boot é exigido pelo
 * `authMiddleware` (o `/mcp` entra na lista protegida).
 */
export function mcpRoutes(deps: IngestionStartDeps & { version: string }) {
  const app = new Hono();
  app.all("/mcp", async (c) => {
    const sid = c.req.header("x-narnia-session") ?? null;
    let session: SessionInfo = { id: null, category: null, runId: null };
    if (sid) {
      const s = (deps.repos as Repos).chatSessions.get(sid);
      if (!s) return apiError(c, 404, "session_not_found", "Sessão de chat não encontrada");
      session = { id: s.id, category: s.category, runId: s.ingestionRunId ?? null };
    }
    const server = buildServer(deps, deps.version, session);
    const transport = // sem sessionIdGenerator = modo sem estado do SDK (cada requisição tem servidor e transporte próprios)
      new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return app;
}
