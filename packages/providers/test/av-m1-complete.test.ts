import { describe, expect, it } from "vitest";
import {
  ClaudeCodeProvider,
  MockProvider,
  type QueryFn,
  type SdkMessageLike,
  type SdkQueryOptions,
} from "../src/index";

/** Avaliações no Phoenix (M1): chamada simples ao modelo, usada pela ponte da assinatura. */
function fakeQuery(messages: SdkMessageLike[]) {
  const calls: Array<{ prompt: string; options: SdkQueryOptions }> = [];
  const query = ((params: { prompt: string; options: SdkQueryOptions }) => {
    calls.push(params);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }) as unknown as QueryFn;
  return { calls, query };
}

const provider = (query: QueryFn) =>
  new ClaudeCodeProvider({
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    query,
    binaryPath: "/bin/claude",
  });

describe("ClaudeCodeProvider.complete", () => {
  it("sem tools, sem configurações do usuário; texto em fragmentos, uso e modelo exato", async () => {
    const f = fakeQuery([
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Olá, " } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Ana." } },
      },
      { type: "assistant", message: { model: "claude-sonnet-4-5-20250929" } },
      {
        type: "result",
        subtype: "success",
        result: "Olá, Ana.",
        usage: { input_tokens: 50, output_tokens: 4, cache_read_input_tokens: 10 },
        total_cost_usd: 0.0003,
      },
    ]);
    const pieces: string[] = [];
    const r = await provider(f.query).complete(
      { system: "Seja breve.", prompt: "Diga oi para a Ana", model: "sonnet" },
      (t) => pieces.push(t),
    );
    expect(pieces).toEqual(["Olá, ", "Ana."]);
    expect(r).toEqual({
      text: "Olá, Ana.",
      structured: null,
      model: "claude-sonnet-4-5-20250929",
      costUsd: 0.0003,
      usage: {
        inputTokens: 50,
        outputTokens: 4,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        model: "claude-sonnet-4-5-20250929",
      },
    });
    const { options, prompt } = f.calls[0] as { prompt: string; options: SdkQueryOptions };
    expect(prompt).toBe("Diga oi para a Ana");
    expect(options).toMatchObject({
      model: "sonnet",
      systemPrompt: "Seja breve.",
      tools: [],
      settingSources: [],
      includePartialMessages: true,
      maxTurns: 1,
    });
    expect(options.outputFormat).toBeUndefined();
  });

  it("com schema: outputFormat json_schema e a saída estruturada vira texto JSON", async () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const f = fakeQuery([
      {
        type: "result",
        subtype: "success",
        result: "",
        structured_output: { ok: true },
        usage: { input_tokens: 5, output_tokens: 2 },
        total_cost_usd: 0,
      },
    ]);
    const r = await provider(f.query).complete({
      system: "s",
      prompt: "p",
      model: "haiku",
      jsonSchema: schema,
    });
    expect(r.structured).toEqual({ ok: true });
    expect(r.text).toBe('{"ok":true}');
    expect(f.calls[0]?.options.outputFormat).toEqual({ type: "json_schema", schema });
    expect(f.calls[0]?.options.maxTurns).toBeGreaterThan(1);
  });

  it("erro do modelo vira ProviderError query_failed com a mensagem", async () => {
    const f = fakeQuery([
      { type: "result", subtype: "success", is_error: true, result: "Credit balance too low" },
    ]);
    await expect(
      provider(f.query).complete({ system: "s", prompt: "p", model: "sonnet" }),
    ).rejects.toMatchObject({ code: "query_failed", message: expect.stringContaining("Credit") });
  });
});

describe("MockProvider.complete", () => {
  it("texto determinístico em fragmentos; com schema, objeto mínimo válido", async () => {
    const p = new MockProvider();
    const pieces: string[] = [];
    const r = await p.complete(
      { system: "s", prompt: "Resuma o currículo", model: "sonnet" },
      (t) => pieces.push(t),
    );
    expect(pieces.join("")).toBe(r.text);
    expect(r.text).toContain("Resuma o currículo");
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    const s = await p.complete({
      system: "s",
      prompt: "p",
      model: "sonnet",
      jsonSchema: {
        type: "object",
        properties: {
          nome: { type: "string" },
          nivel: { type: "string", enum: ["junior", "pleno"] },
          anos: { type: "number" },
          itens: { type: "array", items: { type: "string" } },
          extra: { type: "string" },
        },
        required: ["nome", "nivel", "anos", "itens"],
      },
    });
    expect(s.structured).toEqual({ nome: "exemplo", nivel: "junior", anos: 0, itens: [] });
    expect(JSON.parse(s.text)).toEqual(s.structured);
  });
});
