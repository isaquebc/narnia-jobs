import { setTracer } from "@narnia-jobs/shared";

/**
 * F04/M5 · OpenTelemetry → Arize Phoenix local (F04-15). Só liga com `NARNIA_OTEL_ENDPOINT` (ex.
 * `http://phoenix:6006/v1/traces`); sem ele, os pacotes do OTel nem são carregados e nada sai da máquina (§6.5).
 * Spans agrupados no projeto `narnia-jobs` do Phoenix (`openinference.project.name`).
 */
let shutdownFn: (() => Promise<void>) | null = null;

export async function initTelemetry(
  env: Record<string, string | undefined>,
  serviceName: string,
): Promise<boolean> {
  const endpoint = env.NARNIA_OTEL_ENDPOINT?.trim();
  if (!endpoint) return false;
  const [
    { SpanStatusCode },
    { BasicTracerProvider, BatchSpanProcessor },
    { OTLPTraceExporter },
    { resourceFromAttributes },
  ] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/sdk-trace-base"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/resources"),
  ]);
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "openinference.project.name": env.NARNIA_OTEL_PROJECT ?? "narnia-jobs",
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }))],
  });
  const tracer = provider.getTracer("narnia-jobs");
  setTracer({
    startSpan(name, attrs = {}) {
      const span = tracer.startSpan(name, { attributes: attrs });
      return {
        setAttributes: (a) => {
          span.setAttributes(a);
        },
        recordError: (e) => {
          span.recordException(e instanceof Error ? e : new Error(String(e)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: e instanceof Error ? e.message : String(e),
          });
        },
        end: () => span.end(),
      };
    },
  });
  shutdownFn = async () => {
    setTracer(null);
    await provider.shutdown();
  };
  return true;
}

/** Envia o que estiver pendente e desliga (encerramento do processo e testes). */
export async function shutdownTelemetry(): Promise<void> {
  const fn = shutdownFn;
  shutdownFn = null;
  if (fn) await fn().catch(() => undefined);
}
