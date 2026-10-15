import type { ChatEvent, Usage } from "@narnia-jobs/providers";
import {
  clip,
  contentTracingEnabled,
  messageAttrs,
  type SpanAttrs,
  type SpanHandle,
  startSpan,
  type TraceMessage,
} from "@narnia-jobs/shared";

export interface TurnTraceInit {
  sessionId: string;
  /** Perfil em foco da conversa (contexto, F06-8); null = conversa global. */
  profileId: string | null;
  category: string;
  turnIndex: number;
  /** Modelo da sessão (apelido); cada chamada ao modelo leva o id exato que o SDK devolver. */
  model: string;
  systemPrompt: string;
  /** O que o usuário digitou (entrada do turno). */
  userText: string;
  /** O que foi enviado ao modelo (com as notas de contexto antepostas). */
  sentText: string;
}

export interface TurnTraceEnd {
  text: string;
  usage?: Usage | undefined;
  costUsd?: number | undefined;
  limit?: string | undefined;
  interrupted?: boolean;
  error?: string;
}

interface Step {
  span: SpanHandle;
  input: TraceMessage[];
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage: Usage | null;
  /** Último evento do passo: a chamada ao modelo terminou aí (as tools rodam depois). */
  lastAt: number;
}

const tokenAttrs = (u: Usage): SpanAttrs => {
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return {
    "llm.token_count.prompt": prompt,
    "llm.token_count.prompt_details.cache_read": u.cacheReadTokens,
    "llm.token_count.prompt_details.cache_write": u.cacheWriteTokens,
    "llm.token_count.completion": u.outputTokens,
    "llm.token_count.total": prompt + u.outputTokens,
  };
};

/** Turno em andamento por sessão: o `/mcp` pendura o span dele na tool que o modelo chamou. */
const active = new Map<string, TurnTrace>();

/** Span da tool aberta no turno em andamento da sessão (pai do span `mcp.tool`); undefined fora de um turno. */
export function activeToolSpan(sessionId: string, name: string): SpanHandle | undefined {
  return active.get(sessionId)?.toolSpan(name);
}

/**
 * Rastro de um turno do chat no Phoenix (OpenInference): o turno é o span raiz (CHAIN, com `session.id` para a aba
 * Sessions) e cada chamada ao modelo (LLM) e cada tool (TOOL) viram filhos, na ordem em que aconteceram. A chamada
 * ao modelo leva as mensagens de entrada (system + usuário no 1º passo; resultados das tools nos seguintes) e a saída
 * (texto e chamadas de tool); a tool leva argumentos e resultado. Conteúdo só com `contentTracingEnabled()`.
 */
export class TurnTrace {
  readonly root: SpanHandle;
  private readonly content = contentTracingEnabled();
  private step: Step | null = null;
  private stepStart = Date.now();
  /** Entrada da próxima chamada ao modelo. */
  private nextInput: TraceMessage[];
  private readonly tools = new Map<string, { span: SpanHandle; name: string }>();
  private toolCount = 0;
  private done = false;

  constructor(private readonly init: TurnTraceInit) {
    this.root = startSpan("chat.turn", {
      "openinference.span.kind": "CHAIN",
      "session.id": init.sessionId,
      "user.id": init.profileId ?? "global",
      "tag.tags": [init.category],
      metadata: JSON.stringify({
        category: init.category,
        turnIndex: init.turnIndex,
        profileId: init.profileId,
        model: init.model,
      }),
      "narnia.session_id": init.sessionId,
      "narnia.profile_id": init.profileId ?? "",
      "narnia.category": init.category,
      "narnia.turn_index": init.turnIndex,
      "llm.model_name": init.model,
      ...(this.content
        ? { "input.value": clip(init.userText), "input.mime_type": "text/plain" }
        : {}),
    });
    active.set(init.sessionId, this);
    this.nextInput = [
      { role: "system", content: init.systemPrompt },
      { role: "user", content: init.sentText },
    ];
  }

  private ensureStep(): Step {
    if (this.step) return this.step;
    const span = startSpan(
      "llm",
      {
        "openinference.span.kind": "LLM",
        "llm.provider": "anthropic",
        "llm.system": "anthropic",
        "llm.model_name": this.init.model,
        ...(this.content
          ? {
              ...messageAttrs("llm.input_messages", this.nextInput),
              "input.value": clip(this.nextInput.at(-1)?.content ?? ""),
              "input.mime_type": "text/plain",
            }
          : {}),
      },
      { parent: this.root, startTime: this.stepStart },
    );
    this.step = {
      span,
      input: this.nextInput,
      text: "",
      toolCalls: [],
      usage: null,
      lastAt: Date.now(),
    };
    this.nextInput = [];
    return this.step;
  }

  private closeStep(at: number) {
    const s = this.step;
    if (!s) return;
    this.step = null;
    s.span.setAttributes({
      ...(s.usage ? { ...tokenAttrs(s.usage), "llm.model_name": s.usage.model } : {}),
      ...(this.content
        ? {
            ...messageAttrs("llm.output_messages", [
              { role: "assistant", content: s.text, toolCalls: s.toolCalls },
            ]),
            "output.value": clip(s.text),
            "output.mime_type": "text/plain",
          }
        : {}),
    });
    s.span.end(Math.min(at, Math.max(s.lastAt, this.stepStart)));
  }

  onEvent(e: ChatEvent): void {
    if (this.done) return;
    const now = Date.now();
    switch (e.type) {
      case "text_break": {
        const s = this.ensureStep();
        if (s.text) s.text += "\n\n";
        s.lastAt = now;
        return;
      }
      case "delta": {
        const s = this.ensureStep();
        s.text += e.text;
        s.lastAt = now;
        return;
      }
      case "llm_message": {
        const s = this.ensureStep();
        s.usage = e.usage;
        s.lastAt = now;
        return;
      }
      case "tool_start": {
        const s = this.ensureStep();
        s.toolCalls.push({ id: e.id, name: e.name, arguments: e.input });
        s.lastAt = now;
        this.toolCount++;
        const span = startSpan(
          e.name,
          {
            "openinference.span.kind": "TOOL",
            "tool.name": e.name,
            ...(this.content
              ? {
                  "tool.parameters": clip(e.input),
                  "input.value": clip(e.input),
                  "input.mime_type": "application/json",
                }
              : {}),
          },
          { parent: this.root, startTime: now },
        );
        this.tools.set(e.id, { span, name: e.name });
        return;
      }
      case "tool_end": {
        this.closeStep(now);
        const t = this.tools.get(e.id);
        this.tools.delete(e.id);
        if (t) {
          if (this.content)
            t.span.setAttributes({
              "output.value": clip(e.output),
              "output.mime_type": e.output.trimStart().startsWith("{")
                ? "application/json"
                : "text/plain",
            });
          if (e.isError) t.span.recordError(new Error(e.output || "erro da tool"));
          t.span.end(now);
        }
        this.nextInput.push({ role: "tool", content: e.output, toolCallId: e.id });
        this.stepStart = now;
        return;
      }
      default:
        return;
    }
  }

  /** Span da tool aberta com esse nome publicado (o span do `/mcp` entra como filho dela). */
  toolSpan(name: string): SpanHandle | undefined {
    let found: SpanHandle | undefined;
    for (const t of this.tools.values()) if (t.name === name) found = t.span;
    return found;
  }

  /** Fecha passo, tools abertas e o turno; devolve o span raiz (anotações vão nele). */
  finish(end: TurnTraceEnd): SpanHandle {
    if (this.done) return this.root;
    this.done = true;
    if (active.get(this.init.sessionId) === this) active.delete(this.init.sessionId);
    const now = Date.now();
    this.closeStep(now);
    for (const t of this.tools.values()) t.span.end(now);
    this.tools.clear();
    this.root.setAttributes({
      "narnia.tool_calls": this.toolCount,
      ...(end.usage ? tokenAttrs(end.usage) : {}),
      ...(typeof end.costUsd === "number" ? { "narnia.cost_usd": end.costUsd } : {}),
      ...(end.limit ? { "narnia.limit": end.limit } : {}),
      ...(end.interrupted ? { "narnia.interrupted": true } : {}),
      ...(this.content && end.text
        ? { "output.value": clip(end.text), "output.mime_type": "text/plain" }
        : {}),
    });
    if (end.error) this.root.recordError(new Error(end.error));
    this.root.end(now);
    return this.root;
  }
}
