import { afterEach, describe, expect, it } from "vitest";
import {
  annotateSpan,
  contentTracingEnabled,
  getTracer,
  messageAttrs,
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

  it("conteúdo das conversas vai para o Phoenix local por padrão; NARNIA_OTEL_CONTENT=0 desliga", () => {
    expect(contentTracingEnabled({})).toBe(true);
    expect(contentTracingEnabled({ NARNIA_OTEL_CONTENT: "1" })).toBe(true);
    expect(contentTracingEnabled({ NARNIA_OTEL_CONTENT: "0" })).toBe(false);
  });

  it("filho, horários e anotação passam para o tracer; sem anotador, annotateSpan é no-op", () => {
    const calls: unknown[] = [];
    const parent = { setAttributes() {}, recordError() {}, end() {}, spanId: "p1" };
    const impl: TracerImpl = {
      startSpan(name, attrs, opts) {
        calls.push({ name, attrs, parent: opts?.parent?.spanId, startTime: opts?.startTime });
        return { ...parent, spanId: "c1", end: (t?: number) => calls.push({ end: t }) };
      },
    };
    setTracer(impl);
    const child = startSpan("filho", { a: ["x", "y"] }, { parent, startTime: 1000 });
    child.end(2000);
    annotateSpan(child, [{ name: "n", label: "passou", score: 1, explanation: "ok" }]);
    expect(calls).toEqual([
      { name: "filho", attrs: { a: ["x", "y"] }, parent: "p1", startTime: 1000 },
      { end: 2000 },
    ]);
    const annotated: unknown[] = [];
    setTracer({ ...impl, annotate: (s, list, note) => annotated.push([s.spanId, list, note]) });
    annotateSpan(child, [{ name: "n", label: "passou", score: 1, explanation: "ok" }], "nota");
    expect(annotated).toEqual([
      ["c1", [{ name: "n", label: "passou", score: 1, explanation: "ok" }], "nota"],
    ]);
  });

  it("messageAttrs achata as mensagens no formato OpenInference (papel, conteúdo e chamadas de tool)", () => {
    expect(
      messageAttrs("llm.output_messages", [
        {
          role: "assistant",
          content: "vou ver",
          toolCalls: [{ id: "t1", name: "fact_search", arguments: '{"q":"go"}' }],
        },
        { role: "tool", content: "[]", toolCallId: "t1" },
      ]),
    ).toEqual({
      "llm.output_messages.0.message.role": "assistant",
      "llm.output_messages.0.message.content": "vou ver",
      "llm.output_messages.0.message.tool_calls.0.tool_call.id": "t1",
      "llm.output_messages.0.message.tool_calls.0.tool_call.function.name": "fact_search",
      "llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments": '{"q":"go"}',
      "llm.output_messages.1.message.role": "tool",
      "llm.output_messages.1.message.content": "[]",
      "llm.output_messages.1.message.tool_call_id": "t1",
    });
  });
});
