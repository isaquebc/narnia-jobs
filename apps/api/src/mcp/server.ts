import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createChatTools,
  createCvTools,
  createIngestTools,
  createPostingTools,
  createProfileTools,
  friendlyError,
  friendlyText,
  type Repos,
} from "@narnia-jobs/core";
import {
  CHAT_TOOL_JSON_SCHEMAS,
  CHAT_TOOLS,
  type ChatCategory,
  CV_TOOL_JSON_SCHEMAS,
  CV_TOOLS,
  clip,
  contentTracingEnabled,
  INGEST_TOOL_JSON_SCHEMAS,
  INGEST_TOOLS,
  POSTING_TOOL_JSON_SCHEMAS,
  POSTING_TOOLS,
  PROFILE_TOOL_JSON_SCHEMAS,
  PROFILE_TOOLS,
  withSpan,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import { activeToolSpan } from "../chat/turn-trace";
import { apiError } from "../errors";
import type { IngestionStartDeps } from "../routes/ingestions";
import { intakePosting } from "../services/postings";
import { createChatIngestPort } from "./ingest-port";
import { inScope, narrowsScope, publishedName } from "./scopes";

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

/** Porta da conversa nova da análise (F06): o SessionManager, montado depois das rotas do MCP. */
export type OpenPostingAnalysis = (postingId: string) => { id: string; title: string };
type McpDeps = IngestionStartDeps & { openAnalysis?: OpenPostingAnalysis | undefined };

/** Registro único das tools (F04 §2.2): perfil (F02), arquivos e ingestão (F03), as da conversa (F04) e da vaga (F06). */
function registry(deps: McpDeps, session: SessionInfo): Map<string, ToolEntry> {
  const sessionId = session.id;
  const all = [
    ...entries(
      PROFILE_TOOLS,
      PROFILE_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createProfileTools(deps.repos, { sessionProfileId: session.profileId }),
    ),
    ...entries(
      INGEST_TOOLS,
      INGEST_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createIngestTools(deps.repos, { dataDir: deps.dataDir }),
    ),
    ...entries(
      CHAT_TOOLS,
      CHAT_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createChatTools(deps.repos, { ingest: createChatIngestPort(deps, sessionId), sessionId }),
    ),
    ...entries(
      POSTING_TOOLS,
      POSTING_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createPostingTools(deps.repos, {
        sessionId,
        ports: {
          intake: (i) => intakePosting(deps, i),
          ...(deps.openAnalysis && sessionId
            ? {
                openAnalysis: async (postingId: string) => {
                  const s = (deps.openAnalysis as OpenPostingAnalysis)(postingId);
                  return { sessionId: s.id, title: s.title };
                },
              }
            : {}),
          changed: (postingId) => deps.bus.emit({ type: "posting.updated", postingId }),
          notified: (events) => {
            for (const ev of events)
              deps.bus.emit({
                type: ev.created ? "notification.created" : "notification.updated",
                notification: ev.notification,
              });
          },
        },
      }),
    ),
    ...entries(
      CV_TOOLS,
      CV_TOOL_JSON_SCHEMAS as unknown as SchemaMap,
      createCvTools(deps.repos, {
        ports: {
          enqueue: (req) => deps.queue.enqueueTask(req),
          changed: (doc, status) =>
            deps.bus.emit({
              type: "document.updated",
              documentId: doc.id,
              profileId: doc.profileId,
              postingId: doc.postingId,
              status,
            }),
        },
      }),
    ),
  ];
  return new Map(all.map((t) => [publishedName(t.name), t]));
}

const isZodError = (e: unknown): e is { issues: Array<{ path: PropertyKey[]; message: string }> } =>
  typeof e === "object" && e !== null && Array.isArray((e as { issues?: unknown }).issues);

/** Tools da conversa que criam uma execução de ingestão (o link "Abrir a ingestão criada" vem delas). */
const CREATES_RUN = new Set(["ingest.text", "ingest.file", "ingest.github"]);

/**
 * Erro como `isError`: `[código] mensagem` em pt-BR (tools tipadas) ou `invalid_input`; os demais passam pelo mapa de
 * erros amigáveis (auditoria D): `[<chave>] texto em pt-BR. Detalhe técnico: <original>` (`internal` quando não casa).
 */
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
  const f = friendlyError(message);
  const tag = f.key === "error.unknown" ? "internal" : f.key.replace(/^error\./, "");
  return `[${tag}] ${friendlyText(f).text} Detalhe técnico: ${message}`;
}

function buildServer(deps: McpDeps, version: string, session: SessionInfo) {
  const tools = registry(deps, session);
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
      if (tool.name === "ingest.propose" && session.category === null) {
        const run =
          typeof args.runId === "string"
            ? (deps.repos as Repos).ingestionRuns.get(args.runId)
            : null;
        if (run && run.status !== "review")
          throw new McpToolError(
            "run_not_reviewable",
            `No terminal só dá para propor correções a uma ingestão pronta para revisão (esta está em ${run.status}).`,
          );
      }
      if (
        tool.name === "session.set_category" &&
        session.category &&
        typeof args.category === "string" &&
        !narrowsScope(session.category, args.category as ChatCategory)
      )
        throw new McpToolError(
          "category_not_allowed",
          `A conversa não pode passar de ${session.category} para ${args.category} por conta própria: isso ampliaria as ferramentas. Peça ao usuário para abrir uma conversa nova.`,
        );
      // no chat, o span fica dentro da tool do turno (mesmo rastro); no terminal (modo B) é um rastro próprio
      const parent = session.id ? activeToolSpan(session.id, req.params.name) : undefined;
      const content = contentTracingEnabled();
      const out = await withSpan(
        "mcp.tool",
        {
          "openinference.span.kind": "TOOL",
          "tool.name": tool.name,
          "narnia.session_id": session.id ?? "terminal",
          "narnia.category": session.category ?? "terminal",
          ...(session.id ? { "session.id": session.id } : {}),
          ...(content
            ? { "input.value": clip(JSON.stringify(args)), "input.mime_type": "application/json" }
            : {}),
        },
        async (span) => {
          const r = await tool.call(args);
          if (content)
            span.setAttributes({
              "output.value": clip(JSON.stringify(r) ?? "null"),
              "output.mime_type": "application/json",
            });
          return r;
        },
        { parent },
      );
      // a execução criada por esta conversa: a web mostra o link e o SessionManager grava o runId na tool call
      const created = (out as { runId?: unknown } | null)?.runId;
      if (session.id && CREATES_RUN.has(tool.name) && typeof created === "string")
        deps.bus.emit({ type: "chat.ingestion_created", sessionId: session.id, runId: created });
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
  /** Perfil da conversa: as tools `profile.*` ficam presas a ele (auditoria A); null no terminal. */
  profileId: string | null;
}

/**
 * Servidor MCP em `/mcp` (F04 §2.2, F04-7, F04-11): SDK oficial, transporte HTTP no padrão web, sem estado entre
 * requisições (cada uma monta servidor + transporte com o escopo da sessão). O token de boot é exigido pelo
 * `authMiddleware` (o `/mcp` entra na lista protegida).
 */
export function mcpRoutes(deps: McpDeps & { version: string }) {
  const app = new Hono();
  // sem estado não há stream de notificações (GET) nem sessão a encerrar (DELETE): 405 em vez de um SSE que nunca fecha
  app.on(["GET", "DELETE"], "/mcp", (c) => {
    c.header("Allow", "POST");
    return apiError(
      c,
      405,
      "method_not_allowed",
      "O /mcp deste app só aceita POST (modo sem estado).",
    );
  });
  app.all("/mcp", async (c) => {
    const sid = c.req.header("x-narnia-session") ?? null;
    let session: SessionInfo = { id: null, category: null, runId: null, profileId: null };
    if (sid) {
      const s = (deps.repos as Repos).chatSessions.get(sid);
      if (!s) return apiError(c, 404, "session_not_found", "Sessão de chat não encontrada");
      session = {
        id: s.id,
        category: s.category,
        runId: s.ingestionRunId ?? null,
        profileId: s.profileId,
      };
    }
    const server = buildServer(deps, deps.version, session);
    const transport = // sem sessionIdGenerator = modo sem estado do SDK (cada requisição tem servidor e transporte próprios)
      new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return app;
}
