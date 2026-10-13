import { AsyncLocalStorage } from "node:async_hooks";
import {
  contentTracingEnabled,
  type SpanAnnotation,
  type SpanHandle,
  setTracer,
} from "@narnia-jobs/shared";

/**
 * F04/M5 · OpenTelemetry → Arize Phoenix local (F04-15). Só liga com `NARNIA_OTEL_ENDPOINT` (ex.
 * `http://phoenix:6006/v1/traces`); sem ele, os pacotes do OTel nem são carregados e nada sai da máquina (§6.5).
 * Spans agrupados no projeto `narnia-jobs` do Phoenix (`openinference.project.name`).
 */
let shutdownFn: (() => Promise<void>) | null = null;

const OMITTED = "(conteúdo omitido; NARNIA_OTEL_CONTENT=0)";

/**
 * Erro como vai para o rastro (auditoria E2, 19e): mensagens de erro carregam trechos de saída do modelo (ex.
 * "Saída fora do schema: {…}"); sem `NARNIA_OTEL_CONTENT=1` só o começo (até o primeiro ':' ou quebra de linha,
 * no máximo 120 caracteres) e sem stack, que repete a mensagem inteira.
 */
export function errorForTrace(
  e: unknown,
  content: boolean,
): { name: string; message: string; stack?: string } {
  const name = e instanceof Error ? e.name : "Error";
  const message = e instanceof Error ? e.message : String(e);
  if (content)
    return { name, message, ...(e instanceof Error && e.stack ? { stack: e.stack } : {}) };
  if (!(e instanceof Error)) return { name, message: `erro ${OMITTED}` };
  const head = (message.split(/[:\n]/)[0] ?? "").trim().slice(0, 120);
  return { name, message: `${head || "erro"} ${OMITTED}` };
}

export async function initTelemetry(
  env: Record<string, string | undefined>,
  serviceName: string,
): Promise<boolean> {
  const endpoint = env.NARNIA_OTEL_ENDPOINT?.trim();
  if (!endpoint) return false;
  const [
    { SpanStatusCode, context, trace },
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
  type OtelSpan = ReturnType<typeof tracer.startSpan>;
  // o span do OTel por trás de cada handle da fachada (pai de spans filhos)
  const otelOf = new WeakMap<SpanHandle, OtelSpan>();
  const phoenix = phoenixClient(env, endpoint, () => provider.forceFlush());
  // pai implícito: o span do withSpan em volta (job do worker → chamadas ao modelo dentro dele)
  const current = new AsyncLocalStorage<SpanHandle>();
  setTracer({
    startSpan(name, attrs = {}, opts) {
      const parentHandle = opts?.parent ?? current.getStore();
      const parent = parentHandle ? otelOf.get(parentHandle) : undefined;
      const ctx = parent ? trace.setSpan(context.active(), parent) : undefined;
      const span = tracer.startSpan(
        name,
        { attributes: attrs, ...(opts?.startTime ? { startTime: opts.startTime } : {}) },
        ctx,
      );
      const ids = span.spanContext();
      const handle: SpanHandle = {
        spanId: ids.spanId,
        traceId: ids.traceId,
        setAttributes: (a) => {
          span.setAttributes(a);
        },
        recordError: (e) => {
          const safe = errorForTrace(e, contentTracingEnabled(env));
          span.recordException(safe);
          span.setStatus({ code: SpanStatusCode.ERROR, message: safe.message });
        },
        end: (t) => span.end(t),
      };
      otelOf.set(handle, span);
      return handle;
    },
    annotate: (span, annotations, note) => phoenix.annotate(span, annotations, note),
    runInSpan: (span, fn) => current.run(span, fn),
  });
  shutdownFn = async () => {
    setTracer(null);
    await provider.forceFlush().catch(() => undefined);
    await phoenix.drain();
    await provider.shutdown();
  };
  return true;
}

/**
 * Anotações e notas pela API REST do Phoenix (`NARNIA_PHOENIX_URL` ou a origem do endpoint OTLP). O Phoenix só aceita
 * anotação de span que já recebeu: antes de enviar, esvazia o lote do exportador; 404 = span ainda não gravado,
 * tenta de novo algumas vezes. Uma fila só, em ordem; falha vira um aviso no log, nunca erro da operação.
 */
function phoenixClient(
  env: Record<string, string | undefined>,
  endpoint: string,
  flush: () => Promise<void>,
) {
  let base: string;
  try {
    base = (env.NARNIA_PHOENIX_URL?.trim() || new URL(endpoint).origin).replace(/\/+$/, "");
  } catch {
    base = "";
  }
  const retryMs = Number(env.NARNIA_OTEL_RETRY_MS ?? 1000);
  let chain: Promise<void> = Promise.resolve();
  let warned = false;
  const post = async (path: string, body: unknown) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return;
      if (r.status !== 404) throw new Error(`Phoenix ${path} → ${r.status} ${await r.text()}`);
      await new Promise((res) => setTimeout(res, retryMs * (attempt + 1)));
    }
    throw new Error(`Phoenix ${path}: span não chegou a tempo`);
  };
  return {
    annotate(span: SpanHandle, annotations: SpanAnnotation[], note?: string) {
      const spanId = span.spanId;
      if (!base || !spanId) return;
      chain = chain
        .then(async () => {
          await flush();
          if (annotations.length > 0)
            await post("/v1/span_annotations?sync=true", {
              data: annotations.map((a) => ({
                span_id: spanId,
                name: a.name,
                annotator_kind: "CODE",
                identifier: "narnia",
                result: { label: a.label, score: a.score, explanation: a.explanation },
              })),
            });
          if (note)
            await post("/v1/span_notes", { data: { span_id: spanId, note, identifier: "narnia" } });
        })
        .catch((e: unknown) => {
          if (!warned)
            console.warn(`[telemetria] anotação não registrada: ${(e as Error).message}`);
          warned = true;
        });
    },
    drain: () => chain,
  };
}

/** Envia o que estiver pendente e desliga (encerramento do processo e testes). */
export async function shutdownTelemetry(): Promise<void> {
  const fn = shutdownFn;
  shutdownFn = null;
  if (fn) await fn().catch(() => undefined);
}
