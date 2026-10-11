import {
  type AnalyzeProfilesInput,
  AnalyzeProfilesOutputSchema,
  toJsonSchema,
} from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeProvider,
  MOCK_ANALYZE_PROFILES,
  MockProvider,
  ProviderError,
  type QueryFn,
  type SdkMessageLike,
} from "../src/index";

const INPUT: AnalyzeProfilesInput = {
  identity: { name: "Ana Maria Exemplo", city: "Campinas", country: "BR", remotePref: "remote" },
  experiences: [
    {
      id: "exp-1",
      company: "Zeta Fintech",
      title: "Engineering Manager",
      period: "2024-01 – atual",
      summary: "Gestão de duas squads",
      tech: ["TypeScript"],
      achievements: [{ id: "ach-1", text: "Reduziu o lead time", metric: "de 12 para 5 dias" }],
    },
    {
      id: "exp-2",
      company: "Acme",
      title: "Tech Lead",
      period: "2021-03 – 2023-12",
      tech: ["Node.js"],
      achievements: [],
    },
  ],
  projects: [],
  education: [],
  skills: [{ id: "sk-1", name: "TypeScript", category: "language" }],
  languages: [],
  digests: [],
  existingProfiles: [
    {
      name: "Eng.",
      targetTitle: "Senior Software Engineer",
      seniority: "senior",
      area: "software",
    },
  ],
  dismissedTitles: [],
};

interface Captured {
  prompt: string;
  options: Record<string, unknown>;
}
function fakeQuery(messages: SdkMessageLike[]): QueryFn & { captured: Captured[] } {
  const captured: Captured[] = [];
  const fn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
    captured.push({ prompt: params.prompt, options: params.options ?? {} });
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }) as unknown as QueryFn & { captured: Captured[] };
  fn.captured = captured;
  return fn;
}
const exec = async () => ({ stdout: "", stderr: "", code: 0 });
const result = (structured: unknown): SdkMessageLike[] => [
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    structured_output: structured,
    usage: { input_tokens: 900, output_tokens: 120 },
    total_cost_usd: 0.01,
  },
];

describe("F02/M3 providers · analyzeProfiles", () => {
  it("MockProvider devolve 2 sugestões válidas (EM e Staff) citando fatos da entrada, e respeita errors.analyzeProfiles", async () => {
    const p = new MockProvider();
    const r = await p.analyzeProfiles({ ...INPUT, model: "sonnet" });
    expect(AnalyzeProfilesOutputSchema.safeParse(r.output).success).toBe(true);
    expect(r.output.suggestions).toHaveLength(2);
    expect(r.output.suggestions.map((s) => s.title)).toEqual([
      "Engineering Manager",
      "Staff Engineer",
    ]);
    expect(r.output.suggestions[0]?.supportingFactIds).toEqual(["exp-1", "exp-2"]);
    expect(r.usage.model).toBe("sonnet");
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(MOCK_ANALYZE_PROFILES.suggestions).toHaveLength(2);
    p.setMode({ errors: { analyzeProfiles: "sem modelo" } });
    await expect(p.analyzeProfiles({ ...INPUT, model: "sonnet" })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("ClaudeCodeProvider: tools [], maxTurns 1, modelo da entrada, prompt próprio e outputFormat sem $schema", async () => {
    const query = fakeQuery(result(MOCK_ANALYZE_PROFILES));
    const p = new ClaudeCodeProvider({ exec, query, binaryPath: "/bin/claude" });
    const r = await p.analyzeProfiles({ ...INPUT, model: "sonnet" });
    expect(r.output.suggestions).toHaveLength(2);
    expect(r.usage).toMatchObject({ inputTokens: 900, outputTokens: 120, model: "sonnet" });
    const call = query.captured[0] as Captured;
    expect(call.options).toMatchObject({ tools: [], maxTurns: 3, model: "sonnet" });
    expect(String(call.options.systemPrompt)).toMatch(/recrutador/i);
    expect(call.prompt).toContain("Engineering Manager");
    expect(call.prompt).toContain("exp-1");
    const schema = (call.options.outputFormat as { schema: Record<string, unknown> }).schema;
    expect(schema).toEqual(toJsonSchema(AnalyzeProfilesOutputSchema));
    expect(schema).not.toHaveProperty("$schema");
  });

  it("ClaudeCodeProvider rejeita saída fora do schema com invalid_output", async () => {
    const query = fakeQuery(result({ suggestions: [{ title: "" }] }));
    const p = new ClaudeCodeProvider({ exec, query, binaryPath: "/bin/claude" });
    await expect(p.analyzeProfiles({ ...INPUT, model: "sonnet" })).rejects.toMatchObject({
      code: "invalid_output",
    });
  });
});
