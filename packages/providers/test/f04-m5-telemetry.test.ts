import { setTracer, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeProvider, type QueryFn, type SdkMessageLike } from "../src/index";

/** F04/M5 · cada chamada estruturada ao modelo (F01–F03) vira um span LLM com modelo e tokens. */
describe("F04/M5 · span das chamadas estruturadas", () => {
  afterEach(() => {
    setTracer(null);
    delete process.env.NARNIA_OTEL_CONTENT;
  });

  it("extractFacts gera span llm.structured com operação, modelo e tokens; com NARNIA_OTEL_CONTENT=0, sem o prompt", async () => {
    process.env.NARNIA_OTEL_CONTENT = "0";
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

  it("por padrão o span leva system prompt, prompt e saída como mensagens, provedor e tokens de cache", async () => {
    const spans: Array<{ name: string; attrs: Record<string, unknown> }> = [];
    setTracer({
      startSpan(name, attrs = {}) {
        const s = { name, attrs: { ...attrs } };
        spans.push(s);
        return {
          setAttributes: (a) => Object.assign(s.attrs, a),
          recordError: () => undefined,
          end: () => undefined,
        };
      },
    });
    const output = { files: [{ path: "README.md", reason: "visão geral" }] };
    const query = (() =>
      (async function* () {
        yield {
          type: "result",
          subtype: "success",
          structured_output: output,
          usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 30 },
          total_cost_usd: 0.001,
        } as SdkMessageLike;
      })()) as unknown as QueryFn;
    const p = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      query,
      binaryPath: "/bin/claude",
    });
    await p.pickFiles({
      repo: "ana/projeto-exemplo",
      tree: ["README.md"],
      candidates: [],
      maxFiles: 8,
      model: "haiku",
    });
    const s = spans.find((x) => x.name === "llm.structured");
    expect(s?.attrs).toMatchObject({
      "llm.provider": "anthropic",
      "llm.input_messages.0.message.role": "system",
      "llm.input_messages.1.message.role": "user",
      "llm.output_messages.0.message.role": "assistant",
      "llm.token_count.prompt": 150,
      "llm.token_count.prompt_details.cache_read": 30,
      "llm.token_count.completion": 40,
      "llm.token_count.total": 190,
      "output.mime_type": "application/json",
    });
    expect(String(s?.attrs["input.value"])).toContain("ana/projeto-exemplo");
    expect(JSON.parse(String(s?.attrs["output.value"]))).toEqual(output);
  });
});
