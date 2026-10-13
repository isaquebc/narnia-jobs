import { randomUUID } from "node:crypto";
import { bridgeKey, newId, type Repos, resolveBridgeSettings } from "@narnia-jobs/core";
import type { CompleteResult, Provider } from "@narnia-jobs/providers";
import { nowUtc } from "@narnia-jobs/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tokenMatches } from "../auth";

/**
 * Ponte da assinatura (avaliações no Phoenix, decisão AV-2): `POST /bridge/anthropic/v1/messages` no formato da API
 * de mensagens da Anthropic, respondido pelo Agent SDK com o login da assinatura (`provider.complete`). O Phoenix a
 * usa como provedor Anthropic customizado. Sem tools (a ponte não executa tools de terceiros); parâmetros que o SDK
 * não tem (temperatura, top_p, stop) são ignorados e avisados em `x-narnia-ignored-params`. Fica fora do `/api`: a
 * chave é a da ponte (Configurações › Avaliações), nunca o token de boot.
 */
type ErrorType =
  | "authentication_error"
  | "permission_error"
  | "invalid_request_error"
  | "rate_limit_error"
  | "api_error";

const STATUS: Record<ErrorType, 400 | 401 | 403 | 429 | 500> = {
  authentication_error: 401,
  permission_error: 403,
  invalid_request_error: 400,
  rate_limit_error: 429,
  api_error: 500,
};

const toolUseId = () => `toolu_narnia_${randomUUID().replaceAll("-", "")}`;

const IGNORED = ["temperature", "top_p", "top_k", "stop_sequences", "thinking"] as const;
/** Espera máxima na fila, em múltiplos da concorrência. */
const QUEUE_FACTOR = 4;
const PING_MS = 10_000;

interface Block {
  type: string;
  text?: string;
}
interface MessagesBody {
  model?: string;
  system?: string | Block[];
  messages?: Array<{ role: string; content: string | Block[] }>;
  stream?: boolean;
  tools?: Array<{ name?: string; input_schema?: Record<string, unknown> }>;
  tool_choice?: { type?: string; name?: string };
  output_config?: { format?: { type?: string; schema?: Record<string, unknown> } };
  [k: string]: unknown;
}

class BridgeError extends Error {
  constructor(
    readonly kind: ErrorType,
    message: string,
  ) {
    super(message);
  }
}

const errorBody = (kind: ErrorType, message: string) => ({
  type: "error",
  error: { type: kind, message },
});

const textOf = (content: string | Block[] | undefined): string =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n\n");

/**
 * Pedido da API de mensagens → chamada simples do provider (histórico vira transcrição). Tools: a ponte não executa
 * tools, mas emula o caso dos juízes do Phoenix (uma tool só, ou uma tool forçada por `tool_choice`): o schema da tool
 * vira a saída estruturada e a resposta volta como `tool_use`. Várias tools à escolha do modelo = 400.
 */
export function toCompleteInput(body: MessagesBody, defaultModel: string) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const choice = body.tool_choice;
  let tool: { name: string; schema: Record<string, unknown> } | null = null;
  if (tools.length > 0 && choice?.type !== "none") {
    const picked =
      choice?.type === "tool"
        ? tools.find((t) => t.name === choice.name)
        : tools.length === 1
          ? tools[0]
          : undefined;
    if (!picked?.name)
      throw new BridgeError(
        "invalid_request_error",
        "A ponte da assinatura não executa tools: só emula uma tool forçada (juízes do Phoenix). Rode este prompt sem tools ou use o comando de avaliações do narnia-jobs.",
      );
    tool = { name: picked.name, schema: picked.input_schema ?? { type: "object" } };
  }
  const messages = body.messages ?? [];
  if (messages.length === 0)
    throw new BridgeError("invalid_request_error", "messages: pelo menos uma mensagem");
  const prompt =
    messages.length === 1
      ? textOf(messages[0]?.content)
      : messages
          .map((m) => `${m.role === "assistant" ? "Assistente" : "Usuário"}: ${textOf(m.content)}`)
          .join("\n\n");
  const format = body.output_config?.format;
  return {
    system: textOf(body.system),
    prompt,
    model: body.model?.trim() || defaultModel,
    jsonSchema: tool
      ? tool.schema
      : format?.type === "json_schema" && format.schema
        ? format.schema
        : null,
    tool: tool ? tool.name : null,
  };
}

/** Semáforo com fila curta: acima de `limit` ativos espera; com a fila cheia recusa (429). */
function semaphore() {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async acquire(limit: number): Promise<() => void> {
      if (active >= limit) {
        if (waiting.length >= limit * QUEUE_FACTOR)
          throw new BridgeError(
            "rate_limit_error",
            `A ponte já está com ${active} chamadas e ${waiting.length} na fila; tente de novo em instantes.`,
          );
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
        waiting.shift()?.();
      };
    },
  };
}

export function bridgeRoutes(deps: { repos: Repos; provider: Provider }) {
  const app = new Hono();
  const slots = semaphore();

  const fail = (c: Context, e: unknown) => {
    const kind = e instanceof BridgeError ? e.kind : "api_error";
    return c.json(errorBody(kind, (e as Error).message), STATUS[kind]);
  };

  const recordUsage = (r: CompleteResult) =>
    deps.repos.usageEvents.insert({
      id: newId(),
      ts: nowUtc(),
      origin: "narnia",
      category: "avaliacao.ponte",
      jobId: null,
      sessionId: null,
      model: r.model,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      cacheRead: r.usage.cacheReadTokens,
      cacheWrite: r.usage.cacheWriteTokens,
      costUsdEst: r.costUsd,
    });

  const usageJson = (r: CompleteResult) => ({
    input_tokens: r.usage.inputTokens,
    output_tokens: r.usage.outputTokens,
    cache_read_input_tokens: r.usage.cacheReadTokens,
    cache_creation_input_tokens: r.usage.cacheWriteTokens,
  });

  app.post("/bridge/anthropic/v1/messages", async (c) => {
    const header = c.req.header("authorization");
    const given =
      c.req.header("x-api-key") ?? (header?.startsWith("Bearer ") ? header.slice(7) : null);
    if (!tokenMatches(bridgeKey(deps.repos.settings), given))
      return fail(
        c,
        new BridgeError("authentication_error", "Chave da ponte ausente ou inválida."),
      );
    const settings = resolveBridgeSettings(deps.repos.settings);
    if (!settings.enabled)
      return fail(
        c,
        new BridgeError(
          "permission_error",
          "Ponte da assinatura desligada em Configurações › Avaliações do narnia-jobs.",
        ),
      );
    let body: MessagesBody;
    let input: ReturnType<typeof toCompleteInput>;
    try {
      body = (await c.req.json()) as MessagesBody;
      input = toCompleteInput(body, settings.defaultModel);
    } catch (e) {
      return fail(
        c,
        e instanceof BridgeError ? e : new BridgeError("invalid_request_error", "JSON inválido"),
      );
    }
    const ignored = IGNORED.filter((k) => body[k] !== undefined);
    if (ignored.length > 0) c.header("x-narnia-ignored-params", ignored.join(","));
    let release: () => void;
    try {
      release = await slots.acquire(Math.max(1, settings.concurrency));
    } catch (e) {
      return fail(c, e);
    }
    const id = `msg_narnia_${randomUUID().replaceAll("-", "")}`;

    if (!body.stream) {
      try {
        const { tool, ...call } = input;
        const r = await deps.provider.complete(call);
        recordUsage(r);
        return c.json({
          id,
          type: "message",
          role: "assistant",
          model: r.model,
          content: tool
            ? [{ type: "tool_use", id: toolUseId(), name: tool, input: r.structured ?? {} }]
            : [{ type: "text", text: r.text }],
          stop_reason: tool ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: usageJson(r),
        });
      } catch (e) {
        return fail(c, e);
      } finally {
        release();
      }
    }

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) });
      // o CLI leva alguns segundos para subir: ping mantém a conexão viva
      const ping = setInterval(() => void send("ping", { type: "ping" }), PING_MS);
      try {
        await send("message_start", {
          type: "message_start",
          message: {
            id,
            type: "message",
            role: "assistant",
            model: input.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
        const { tool, ...call } = input;
        if (tool) {
          // juiz do Phoenix: a saída estruturada vai inteira como o JSON da tool
          const r = await deps.provider.complete(call);
          recordUsage(r);
          await send("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: toolUseId(), name: tool, input: {} },
          });
          await send("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(r.structured ?? {}) },
          });
          await send("content_block_stop", { type: "content_block_stop", index: 0 });
          await send("message_delta", {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null },
            usage: usageJson(r),
          });
        } else {
          await send("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          });
          let streamed = false;
          const pending: Promise<void>[] = [];
          const delta = (text: string) =>
            send("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text },
            });
          const r = await deps.provider.complete(
            call,
            call.jsonSchema
              ? undefined
              : (text) => {
                  streamed = true;
                  pending.push(delta(text));
                },
          );
          await Promise.all(pending);
          // saída estruturada (ou provider sem fragmentos): o texto inteiro num delta só
          if (!streamed && r.text) await delta(r.text);
          recordUsage(r);
          await send("content_block_stop", { type: "content_block_stop", index: 0 });
          await send("message_delta", {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: usageJson(r),
          });
        }
        await send("message_stop", { type: "message_stop" });
      } catch (e) {
        await send("error", errorBody("api_error", (e as Error).message));
      } finally {
        clearInterval(ping);
        release();
      }
    });
  });
  return app;
}
