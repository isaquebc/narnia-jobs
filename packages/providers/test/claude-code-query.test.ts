import { EXTRACTION_JSON_SCHEMAS } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeProvider,
  MOCK_DIGEST,
  MOCK_EXTRACT_FACTS,
  MOCK_READ_DOCUMENT,
  ProviderError,
  type QueryFn,
  type SdkMessageLike,
} from "../src/index";

interface Captured {
  prompt: string;
  options: Record<string, unknown>;
}

function fakeQuery(
  messages: SdkMessageLike[] | ((c: Captured) => SdkMessageLike[]),
): QueryFn & { captured: Captured[] } {
  const captured: Captured[] = [];
  const fn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
    const c = { prompt: params.prompt, options: params.options ?? {} };
    captured.push(c);
    const list = typeof messages === "function" ? messages(c) : messages;
    return (async function* () {
      for (const m of list) yield m;
    })();
  }) as unknown as QueryFn & { captured: Captured[] };
  fn.captured = captured;
  return fn;
}

const USAGE = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 50,
};

function success(structured: unknown, extra: Partial<SdkMessageLike> = {}): SdkMessageLike[] {
  return [
    { type: "system", subtype: "init" },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      structured_output: structured,
      usage: USAGE,
      total_cost_usd: 0.0123,
      ...extra,
    },
  ];
}

const exec = async () => ({ stdout: "", stderr: "", code: 0 });

describe("M4/providers ClaudeCodeProvider via Agent SDK (query injetado)", () => {
  it("extractFacts: tools [], maxTurns 1, model, systemPrompt próprio e outputFormat com o schema de fatos", async () => {
    const q = fakeQuery(success(MOCK_EXTRACT_FACTS));
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/bin/claude" });
    const r = await p.extractFacts({ text: "CV TEXTO", locale: "pt-BR", model: "haiku" });
    const o = q.captured[0]?.options ?? {};
    expect(o.tools).toEqual([]);
    expect(o.maxTurns).toBe(3);
    expect(o.model).toBe("haiku");
    expect(o.outputFormat).toEqual({
      type: "json_schema",
      schema: EXTRACTION_JSON_SCHEMAS.extractFacts,
    });
    expect(String(o.systemPrompt)).toMatch(/currícul|curricul/i);
    expect(q.captured[0]?.prompt).toContain("CV TEXTO");
    expect(r.output.experiences.length).toBeGreaterThan(0);
    expect(r.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      model: "haiku",
    });
    expect(r.costUsd).toBeCloseTo(0.0123);
    expect(r.sdk.usage?.input_tokens).toBe(1200);
  });

  it("buildDigest: recebe texto + propostas no prompt, modelo configurado e schema de digest", async () => {
    const q = fakeQuery(success(MOCK_DIGEST));
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/bin/claude" });
    const proposals = [
      {
        kind: "skill" as const,
        confidence: 0.9,
        data: { name: "Go", category: "language" as const },
      },
    ];
    const r = await p.buildDigest({ text: "TEXTO", proposals, locale: "pt-BR", model: "sonnet" });
    const o = q.captured[0]?.options ?? {};
    expect(o.model).toBe("sonnet");
    expect(o.tools).toEqual([]);
    expect(o.maxTurns).toBe(3);
    expect(o.outputFormat).toEqual({
      type: "json_schema",
      schema: EXTRACTION_JSON_SCHEMAS.buildDigest,
    });
    expect(q.captured[0]?.prompt).toContain('"Go"');
    expect(r.output.keyPoints.length).toBeGreaterThan(0);
  });

  it("readDocument: tools [Read], allowedTools [Read], cwd restrito à pasta do arquivo, maxTurns 6 (PDF > 20 páginas lê em partes), schema de leitura", async () => {
    const q = fakeQuery(success(MOCK_READ_DOCUMENT));
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/bin/claude" });
    const r = await p.readDocument({
      filePath: "/data/uploads/abc123.pdf",
      locale: "pt-BR",
      model: "haiku",
    });
    const o = q.captured[0]?.options ?? {};
    expect(o.tools).toEqual(["Read"]);
    expect(o.allowedTools).toEqual(["Read"]);
    expect(o.cwd).toBe("/data/uploads");
    expect(o.additionalDirectories).toBeUndefined();
    expect(o.maxTurns).toBe(6);
    expect(o.outputFormat).toEqual({
      type: "json_schema",
      schema: EXTRACTION_JSON_SCHEMAS.readDocument,
    });
    expect(q.captured[0]?.prompt).toContain("abc123.pdf");
    expect(r.output.text.length).toBeGreaterThan(0);
  });

  it("structured_output ausente → faz parse do JSON no texto do resultado (com cercas de código)", async () => {
    const q = fakeQuery(
      success(undefined, {
        result: `Aqui está:\n\`\`\`json\n${JSON.stringify(MOCK_DIGEST)}\n\`\`\``,
      }),
    );
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/bin/claude" });
    const r = await p.buildDigest({ text: "t", proposals: [], locale: "pt-BR", model: "sonnet" });
    expect(r.output.summary).toBe(MOCK_DIGEST.summary);
  });

  it("subtype error_max_structured_output_retries sem JSON aproveitável → ProviderError structured_output_failed", async () => {
    const q = fakeQuery([
      {
        type: "result",
        subtype: "error_max_structured_output_retries",
        is_error: true,
        result: "não consegui",
        usage: USAGE,
        total_cost_usd: 0.01,
      },
    ]);
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/bin/claude" });
    const err = await p
      .extractFacts({ text: "t", locale: "pt-BR", model: "haiku" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("structured_output_failed");
  });

  it("saída que não passa no schema → ProviderError invalid_output", async () => {
    const q = fakeQuery(success({ summary: 42 }));
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/bin/claude" });
    const err = await p
      .buildDigest({ text: "t", proposals: [], locale: "pt-BR", model: "sonnet" })
      .catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe("invalid_output");
  });

  it("stream sem mensagem result → ProviderError query_failed", async () => {
    const q = fakeQuery([{ type: "system", subtype: "init" }]);
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/bin/claude" });
    const err = await p
      .extractFacts({ text: "t", locale: "pt-BR", model: "haiku" })
      .catch((e: unknown) => e);
    expect((err as ProviderError).code).toBe("query_failed");
  });

  it("pathToClaudeCodeExecutable é repassado quando binaryPath é informado", async () => {
    const q = fakeQuery(success(MOCK_EXTRACT_FACTS));
    const p = new ClaudeCodeProvider({ exec, query: q, binaryPath: "/custom/claude" });
    await p.extractFacts({ text: "t", locale: "pt-BR", model: "haiku" });
    expect(q.captured[0]?.options.pathToClaudeCodeExecutable).toBe("/custom/claude");
  });
});
