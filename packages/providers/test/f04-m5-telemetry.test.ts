import { setTracer, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeProvider, type QueryFn, type SdkMessageLike } from "../src/index";

/** F04/M5 · cada chamada estruturada ao modelo (F01–F03) vira um span LLM com modelo e tokens. */
describe("F04/M5 · span das chamadas estruturadas", () => {
  afterEach(() => setTracer(null));

  it("extractFacts gera span llm.structured com operação, modelo e tokens, sem o prompt", async () => {
    const spans: Array<{ name: string; attrs: Record<string, unknown>; ended: boolean }> = [];
    const impl: TracerImpl = {
      startSpan(name, attrs = {}) {
        const s = { name, attrs: { ...attrs }, ended: false };
        spans.push(s);
        return {
          setAttributes: (a) => Object.assign(s.attrs, a),
          recordError: () => undefined,
          end: () => {
            s.ended = true;
          },
        };
      },
    };
    setTracer(impl);
    const messages: SdkMessageLike[] = [
      {
        type: "result",
        subtype: "success",
        structured_output: {
          identity: null,
          experiences: [],
          education: [],
          skills: [],
          languages: [],
          links: [],
        },
        usage: { input_tokens: 120, output_tokens: 40 },
        total_cost_usd: 0,
      },
    ];
    const query = (() =>
      (async function* () {
        for (const m of messages) yield m;
      })()) as unknown as QueryFn;
    const p = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      query,
      binaryPath: "/bin/claude",
    });
    await p
      .extractFacts({ text: "Ana Maria Exemplo, engenheira", locale: "pt-BR", model: "haiku" })
      .catch(() => undefined);
    const s = spans.find((x) => x.name === "llm.structured");
    expect(s?.ended).toBe(true);
    expect(s?.attrs).toMatchObject({
      "openinference.span.kind": "LLM",
      "llm.model_name": "haiku",
      "narnia.operation": "extractFacts",
    });
    expect(s?.attrs).not.toHaveProperty("input.value");
  });
});
