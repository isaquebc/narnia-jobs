/**
 * F04/M5 · fachada de rastros (OpenTelemetry → Arize Phoenix local). Sem tracer registrado é no-op: nada é coletado
 * nem enviado. O `core` registra o tracer real só quando `NARNIA_OTEL_ENDPOINT` existe (initTelemetry); provider,
 * api e worker só falam com esta fachada, sem depender do OTel.
 */
export type SpanAttrs = Record<string, string | number | boolean>;

export interface SpanHandle {
  setAttributes(attrs: SpanAttrs): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface TracerImpl {
  startSpan(name: string, attrs?: SpanAttrs): SpanHandle;
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

export function startSpan(name: string, attrs: SpanAttrs = {}): SpanHandle {
  if (!tracer) return NOOP;
  try {
    return tracer.startSpan(name, attrs);
  } catch {
    return NOOP; // rastro nunca derruba a operação
  }
}

export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: SpanHandle) => Promise<T>,
): Promise<T> {
  const span = startSpan(name, attrs);
  try {
    return await fn(span);
  } catch (e) {
    span.recordError(e);
    throw e;
  } finally {
    span.end();
  }
}

/** Conteúdo (perguntas, respostas, argumentos de tools) só entra nos rastros com `NARNIA_OTEL_CONTENT=1`. */
export function contentTracingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NARNIA_OTEL_CONTENT === "1";
}

/** Corta conteúdo longo antes de ir para um atributo de span. */
export function clip(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
