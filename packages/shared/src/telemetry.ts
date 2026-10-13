/**
 * F04/M5 · fachada de rastros (OpenTelemetry → Arize Phoenix local). Sem tracer registrado é no-op: nada é coletado
 * nem enviado. O `core` registra o tracer real só quando `NARNIA_OTEL_ENDPOINT` existe (initTelemetry); provider,
 * api e worker só falam com esta fachada, sem depender do OTel.
 */
export type SpanAttrValue = string | number | boolean | string[];
export type SpanAttrs = Record<string, SpanAttrValue>;

export interface SpanHandle {
  setAttributes(attrs: SpanAttrs): void;
  recordError(error: unknown): void;
  /** `endTime` em ms desde a época; ausente = agora. */
  end(endTime?: number): void;
  /** Ids hex do OTel (tracer real): é por eles que o Phoenix recebe anotações e notas. */
  readonly spanId?: string;
  readonly traceId?: string;
}

export interface SpanOptions {
  /** Span pai: o filho entra no mesmo rastro (turno → chamada ao modelo → tool). */
  parent?: SpanHandle | undefined;
  /** Início em ms desde a época (ex.: a chamada ao modelo começou quando a tool anterior terminou). */
  startTime?: number | undefined;
}

/** Avaliação gravada num span (Phoenix: annotation, `annotator_kind` CODE). */
export interface SpanAnnotation {
  name: string;
  label: string;
  score: number;
  explanation: string;
}

export interface TracerImpl {
  startSpan(name: string, attrs?: SpanAttrs, opts?: SpanOptions): SpanHandle;
  /** Anotações (e uma nota opcional) no span já encerrado; ausente = sem destino (testes, sem Phoenix). */
  annotate?(span: SpanHandle, annotations: SpanAnnotation[], note?: string): void;
  /** Roda `fn` com `span` como pai implícito dos spans abertos dentro dela (contexto assíncrono, só no Node). */
  runInSpan?<T>(span: SpanHandle, fn: () => T): T;
}

const NOOP: SpanHandle = {
  setAttributes: () => undefined,
  recordError: () => undefined,
  end: () => undefined,
};
let tracer: TracerImpl | null = null;

export function setTracer(impl: TracerImpl | null): void {
  tracer = impl;
}

export function getTracer(): TracerImpl | null {
  return tracer;
}

export function startSpan(name: string, attrs: SpanAttrs = {}, opts?: SpanOptions): SpanHandle {
  if (!tracer) return NOOP;
  try {
    return opts ? tracer.startSpan(name, attrs, opts) : tracer.startSpan(name, attrs);
  } catch {
    return NOOP; // rastro nunca derruba a operação
  }
}

export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: SpanHandle) => Promise<T>,
  opts?: SpanOptions,
): Promise<T> {
  const span = startSpan(name, attrs, opts);
  const run = tracer?.runInSpan;
  try {
    return await (run ? run(span, () => fn(span)) : fn(span));
  } catch (e) {
    span.recordError(e);
    throw e;
  } finally {
    span.end();
  }
}

/** Grava avaliações (e uma nota) no span; no-op sem tracer ou sem anotador. Nunca lança. */
export function annotateSpan(span: SpanHandle, annotations: SpanAnnotation[], note?: string): void {
  if (!tracer?.annotate || annotations.length + (note ? 1 : 0) === 0) return;
  try {
    tracer.annotate(span, annotations, note);
  } catch {
    // anotação nunca derruba a operação
  }
}

/**
 * Conteúdo (perguntas, respostas, prompts, argumentos e resultados de tools) vai para os rastros por padrão: o
 * Phoenix é local (127.0.0.1) e os dados ficam no volume dele. `NARNIA_OTEL_CONTENT=0` deixa só os metadados.
 */
export function contentTracingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NARNIA_OTEL_CONTENT !== "0";
}

/** Corta conteúdo longo antes de ir para um atributo de span. */
export function clip(text: string, max = 16000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface TraceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  /** Mensagem `tool`: a qual chamada ela responde. */
  toolCallId?: string;
}

/** Mensagens no formato achatado do OpenInference (`llm.input_messages.N.message.*`), que o Phoenix mostra como chat. */
export function messageAttrs(
  prefix: "llm.input_messages" | "llm.output_messages",
  messages: TraceMessage[],
): SpanAttrs {
  const out: SpanAttrs = {};
  messages.forEach((m, i) => {
    const p = `${prefix}.${i}.message`;
    out[`${p}.role`] = m.role;
    out[`${p}.content`] = clip(m.content);
    (m.toolCalls ?? []).forEach((c, j) => {
      const q = `${p}.tool_calls.${j}.tool_call`;
      out[`${q}.id`] = c.id;
      out[`${q}.function.name`] = c.name;
      out[`${q}.function.arguments`] = clip(c.arguments);
    });
    if (m.toolCallId) out[`${p}.tool_call_id`] = m.toolCallId;
  });
  return out;
}
