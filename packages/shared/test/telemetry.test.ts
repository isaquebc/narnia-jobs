import { afterEach, describe, expect, it } from "vitest";
import {
  contentTracingEnabled,
  getTracer,
  setTracer,
  startSpan,
  type TracerImpl,
  withSpan,
} from "../src/telemetry";

/** F04/M5 · fachada de rastros: no-op sem tracer (nenhum dado sai da máquina), registrável nos testes e no OTel. */
function fakeTracer() {
  const spans: Array<{
    name: string;
    attrs: Record<string, unknown>;
    ended: boolean;
    error?: string;
  }> = [];
  const impl: TracerImpl = {
    startSpan(name, attrs = {}) {
      const s = { name, attrs: { ...attrs }, ended: false } as (typeof spans)[number];
      spans.push(s);
      return {
        setAttributes: (a) => Object.assign(s.attrs, a),
        recordError: (e) => {
          s.error = e instanceof Error ? e.message : String(e);
        },
        end: () => {
          s.ended = true;
        },
      };
    },
  };
  return { spans, impl };
}

describe("F04/M5 · telemetria (fachada)", () => {
  afterEach(() => setTracer(null));

  it("sem tracer, spans são no-op e não falham", async () => {
    expect(getTracer()).toBeNull();
    const s = startSpan("x", { a: 1 });
    s.setAttributes({ b: 2 });
    s.recordError(new Error("e"));
    s.end();
    await expect(withSpan("y", {}, async () => 42)).resolves.toBe(42);
  });

  it("com tracer, withSpan registra atributos, erro e encerra o span", async () => {
    const f = fakeTracer();
    setTracer(f.impl);
    await withSpan("ok", { "narnia.k": "v" }, async (s) => s.setAttributes({ "narnia.n": 3 }));
    await expect(
      withSpan("falha", {}, async () => {
        throw new Error("quebrou");
      }),
    ).rejects.toThrow("quebrou");
    expect(f.spans).toEqual([
      { name: "ok", attrs: { "narnia.k": "v", "narnia.n": 3 }, ended: true },
      { name: "falha", attrs: {}, ended: true, error: "quebrou" },
    ]);
  });

  it("conteúdo de mensagens só entra com NARNIA_OTEL_CONTENT=1", () => {
    expect(contentTracingEnabled({})).toBe(false);
    expect(contentTracingEnabled({ NARNIA_OTEL_CONTENT: "0" })).toBe(false);
    expect(contentTracingEnabled({ NARNIA_OTEL_CONTENT: "1" })).toBe(true);
  });
});
