import type { Usage } from "./provider";

/**
 * Sessão longa de chat (F04 M3, §2.5): o `api` abre uma `ChatHandle` por sessão viva, empurra as mensagens do usuário
 * (entrada em streaming do SDK) e consome eventos normalizados. Os eventos do SDK do Claude Code e os roteiros do mock
 * viram o mesmo `ChatEvent`.
 */
export type ChatEvent =
  | { type: "init"; providerSessionId: string }
  | { type: "delta"; text: string }
  /** Começo de um bloco de texto novo no turno (narração antes da tool, resposta final): a api separa com "\n\n". */
  | { type: "text_break" }
  /** `args`: resumo (até 500) para o histórico; `input`: o JSON inteiro, para o rastro. */
  | { type: "tool_start"; id: string; name: string; args: string; input: string }
  /** `output`: o que a tool devolveu ao modelo (texto), para o rastro. */
  | { type: "tool_end"; id: string; isError: boolean; output: string }
  /**
   * Uma resposta do modelo dentro do turno (mensagem `assistant` do SDK): modelo exato e uso daquela chamada. O CLI
   * repete a mesma mensagem por bloco de conteúdo, com o mesmo `messageId` (o rastro fica com o último uso).
   */
  | { type: "llm_message"; messageId: string; model: string; usage: Usage }
  | {
      type: "turn_end";
      text: string;
      providerSessionId: string | null;
      /** Total ACUMULADO da query() até este turno (o SDK não manda o custo do turno; a api calcula o delta). */
      costUsd: number;
      usage: Usage;
      /** Turno cortado pelo "Parar" (`terminal_reason` aborted_*). */
      interrupted?: boolean;
    }
  | { type: "limit"; reason: "max_turns" | "max_budget"; usage: Usage; costUsd: number }
  | {
      type: "error";
      message: string;
      /** Erro de API que fechou um turno (`success` com `is_error`): uso e total acumulado, quando vierem. */
      usage?: Usage;
      costUsd?: number;
    };

export interface ChatOpenOptions {
  systemPrompt: string;
  model: string;
  /** Id da sessão no provider para retomar (hibernada, reinício do api). */
  resume?: string | null;
  /** Turnos do agente por mensagem do usuário (`chat.max_turns`). */
  maxTurns: number;
  /** Teto de custo por sessão (`chat.max_budget_usd`); null = sem teto. */
  maxBudgetUsd?: number | null;
  /** Servidor MCP do app (`/mcp`) com o token e o header da sessão (escopo de tools, F04-2). */
  mcp: { url: string; headers: Record<string, string> };
  /** Pasta do plugin (persona, skills, hook); null nos testes. */
  pluginDir?: string | null;
  /** Tools nativas liberadas pela categoria (ex.: WebSearch). */
  tools: string[];
  /** Variáveis acrescentadas ao ambiente do processo do CLI (`NARNIA_SESSION_HAS_CARD`). */
  env?: Record<string, string>;
  category: string;
  ingestionRunId?: string | null;
  /** Só o mock usa: como chamar o `/mcp` (nos testes da api, o `app.request` em memória). */
  fetch?: typeof fetch;
  /**
   * Leitura web (WebFetch) permitida para esta URL? Lista de domínios confiáveis lida a cada chamada (auditoria
   * pós-F04, bloco A: página com instruções escondidas não pode mandar dados do perfil para fora). Ausente = nega.
   */
  canFetch?: (url: string) => boolean;
}

export interface ChatHandle {
  send(text: string): void;
  readonly events: AsyncIterable<ChatEvent>;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  close(): void;
}

/* ---------- SDK ---------- */

interface SdkUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Subconjunto estrutural das mensagens do SDK que o chat usa. */
export interface SdkChatMessageLike {
  type: string;
  subtype?: string;
  session_id?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
    content_block?: { type?: string };
  };
  message?: {
    id?: string;
    model?: string;
    usage?: SdkUsageLike;
    content?:
      | string
      | Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          is_error?: boolean;
          text?: string;
          /** Resultado da tool (bloco `tool_result`): texto ou blocos de texto. */
          content?: string | Array<{ type: string; text?: string }>;
        }>;
  };
  result?: string;
  usage?: SdkUsageLike;
  total_cost_usd?: number;
  errors?: string[];
  /** `success` com `is_error: true` = turno que terminou num erro de API (texto do erro em `result`). */
  is_error?: boolean;
  /** Por que o turno terminou (`aborted_streaming`/`aborted_tools` = interrompido). */
  terminal_reason?: string;
}

/** Mensagem de usuário da entrada em streaming (`SDKUserMessage`). */
export interface SdkUserMessageLike {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

export interface ChatSdkOptions {
  model: string;
  /**
   * Sem snapshot: o CLI renderiza o prompt a cada requisição em vez de gravá-lo no transcript e reusá-lo no `resume`
   * (auditoria B). Assim persona, domínios e cartão atuais valem a cada reabertura da conversa.
   */
  systemPrompt: { type: "custom"; prompt: string; snapshot: false };
  resume?: string;
  maxTurns: number;
  maxBudgetUsd?: number;
  includePartialMessages: true;
  tools: string[];
  allowedTools: string[];
  /** Texto do usuário literal: sem slash commands nem `@arquivo` (auditoria A). */
  verbatimPrompts: true;
  canUseTool: ChatCanUseTool;
  /** `skipMcpDiscovery`: o api é dono da conexão MCP; o `.mcp.json` do plugin (modo B) não sobe um 2º servidor. */
  plugins: Array<{ type: "local"; path: string; skipMcpDiscovery: true }>;
  /** `alwaysLoad`: tools sempre no prompt e o CLI espera o `/mcp` conectar antes do turno 1. */
  mcpServers: Record<
    string,
    { type: "http"; url: string; headers: Record<string, string>; alwaysLoad: true }
  >;
  env: Record<string, string | undefined>;
  settingSources: [];
  pathToClaudeCodeExecutable?: string;
}

export type ChatPermission =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/** Subconjunto do `canUseTool` do SDK: chamado só para o que não está em `allowedTools`. */
export type ChatCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal },
) => Promise<ChatPermission>;

export const FETCH_DENIED_MESSAGE =
  "Leitura bloqueada: este domínio não está na lista de domínios confiáveis. Não use esta página; se ela for " +
  "importante, peça ao usuário que adicione o domínio em Configurações › Chat e tente de novo.";

/**
 * Permissões da sessão de chat: WebFetch só para URL http(s) aprovada por `canFetch`; qualquer outra tool que chegue
 * aqui (fora de `allowedTools`) é negada, porque o chat não tem quem aprove na hora.
 */
export function chatCanUseTool(canFetch?: (url: string) => boolean): ChatCanUseTool {
  return async (toolName, input) => {
    if (toolName === "WebFetch") {
      const url = typeof input.url === "string" ? input.url : "";
      if (/^https?:\/\//i.test(url) && canFetch?.(url))
        return { behavior: "allow", updatedInput: input };
      return { behavior: "deny", message: FETCH_DENIED_MESSAGE };
    }
    return {
      behavior: "deny",
      message: `A ferramenta ${toolName} não está liberada nas conversas do narnia-jobs.`,
    };
  };
}

export type ChatQueryLike = AsyncIterable<SdkChatMessageLike> & {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  close?(): void;
};

export type ChatQueryFn = (params: {
  prompt: AsyncIterable<SdkUserMessageLike>;
  options: ChatSdkOptions;
}) => ChatQueryLike;

/** As tools MCP chegam prefixadas pelo SDK (`mcp__narnia-jobs__experience_list`): a UI mostra só o nome publicado. */
export function toolDisplayName(name: string): string {
  const m = /^mcp__[^_]+(?:-[^_]+)*__(.+)$/.exec(name);
  return m ? (m[1] as string) : name;
}

const ARGS_MAX = 500;
const summarizeArgs = (input: unknown) => {
  const s = JSON.stringify(input ?? {});
  return s.length > ARGS_MAX ? `${s.slice(0, ARGS_MAX - 1)}…` : s;
};

function usageOf(u: SdkUsageLike | undefined, model: string): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    model,
  };
}

/** Texto devolvido pela tool ao modelo (string ou blocos de texto). */
function toolResultText(c: string | Array<{ type: string; text?: string }> | undefined): string {
  if (typeof c === "string") return c;
  return (c ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}

/** Converte uma mensagem do SDK em zero ou mais eventos de chat (função pura, testada por fixture). */
export function normalizeSdkChatMessage(m: SdkChatMessageLike, model: string): ChatEvent[] {
  if (m.type === "system" && m.subtype === "init" && m.session_id)
    return [{ type: "init", providerSessionId: m.session_id }];
  if (m.type === "stream_event") {
    if (m.event?.type === "content_block_start" && m.event.content_block?.type === "text")
      return [{ type: "text_break" }];
    const d = m.event?.delta;
    if (m.event?.type === "content_block_delta" && d?.type === "text_delta" && d.text)
      return [{ type: "delta", text: d.text }];
    return [];
  }
  const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
  if (m.type === "assistant") {
    const step: ChatEvent[] =
      m.message?.id && m.message.usage
        ? [
            {
              type: "llm_message",
              messageId: m.message.id,
              model: m.message.model ?? model,
              usage: usageOf(m.message.usage, m.message.model ?? model),
            },
          ]
        : [];
    return [
      ...step,
      ...blocks
        .filter((b) => b.type === "tool_use" && b.id && b.name)
        .map((b) => ({
          type: "tool_start" as const,
          id: b.id as string,
          name: toolDisplayName(b.name as string),
          args: summarizeArgs(b.input),
          input: JSON.stringify(b.input ?? {}),
        })),
    ];
  }
  if (m.type === "user")
    return blocks
      .filter((b) => b.type === "tool_result" && b.tool_use_id)
      .map((b) => ({
        type: "tool_end" as const,
        id: b.tool_use_id as string,
        isError: b.is_error === true,
        output: toolResultText(b.content),
      }));
  if (m.type === "result") {
    const usage = usageOf(m.usage, model);
    const costUsd = m.total_cost_usd ?? 0;
    if (m.terminal_reason?.startsWith("aborted"))
      return [
        {
          type: "turn_end",
          text: m.result ?? "",
          providerSessionId: m.session_id ?? null,
          costUsd,
          usage,
          interrupted: true,
        },
      ];
    if (m.subtype === "success" && m.is_error)
      return [{ type: "error", message: m.result || "Erro da API do Claude", usage, costUsd }];
    if (m.subtype === "success")
      return [
        {
          type: "turn_end",
          text: m.result ?? "",
          providerSessionId: m.session_id ?? null,
          costUsd,
          usage,
        },
      ];
    if (m.subtype === "error_max_turns")
      return [{ type: "limit", reason: "max_turns", usage, costUsd }];
    if (m.subtype === "error_max_budget_usd")
      return [{ type: "limit", reason: "max_budget", usage, costUsd }];
    return [
      {
        type: "error",
        message: m.errors?.join("; ") || m.result || `Falha no chat (${m.subtype})`,
        usage,
        costUsd,
      },
    ];
  }
  return [];
}

/* ---------- filas ---------- */

/** Fila assíncrona simples: produtores empurram, um consumidor itera; `end` encerra a iteração. */
export function createAsyncQueue<T>() {
  const items: T[] = [];
  const waiters: Array<(r: IteratorResult<T>) => void> = [];
  let ended = false;
  return {
    push(item: T) {
      if (ended) return;
      const w = waiters.shift();
      if (w) w({ value: item, done: false });
      else items.push(item);
    },
    end() {
      ended = true;
      for (const w of waiters.splice(0)) w({ value: undefined, done: true });
    },
    get ended() {
      return ended;
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            const item = items.shift();
            if (item !== undefined) return Promise.resolve({ value: item, done: false });
            if (ended) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => waiters.push(resolve));
          },
          return: () => {
            ended = true;
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    } as AsyncIterable<T>,
  };
}
