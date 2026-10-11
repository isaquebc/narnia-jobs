import {
  AnalyzeRepoOutputSchema,
  CheckProposalsOutputSchema,
  ExtractFactsOutputSchema,
  extractFactsOutputWithEvidence,
  INGEST_OUTPUT_JSON_SCHEMAS,
  PickFilesOutputSchema,
  PlanUsageSchema,
  SynthesizeRunOutputSchema,
} from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeProvider,
  MOCK_CV_TEXT,
  MOCK_PLAN_USAGE,
  MockProvider,
  mapSdkUsageResponse,
  PROMPTS,
  type QueryFn,
  type SdkMessageLike,
} from "../src/index";

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
const result = (structured: unknown): SdkMessageLike => ({
  type: "result",
  subtype: "success",
  structured_output: structured,
  usage: { input_tokens: 120, output_tokens: 40 },
  total_cost_usd: 0,
});

const CONTEXT = [
  "# Repositório ana-exemplo/api-pagamentos",
  "## README.md",
  "API de pagamentos em TypeScript com Fastify e PostgreSQL.",
  "## package.json",
  '{ "dependencies": { "fastify": "4.0.0", "pg": "8.0.0" } }',
].join("\n");

const ANALYZE_OUT = {
  projects: [
    {
      confidence: 0.9,
      name: "api-pagamentos",
      tech: ["TypeScript"],
      evidence: { ref: "README.md", quote: "API de pagamentos em TypeScript" },
    },
  ],
  skills: [
    {
      confidence: 0.8,
      name: "PostgreSQL",
      category: "data",
      evidence: { ref: "README.md", quote: "PostgreSQL" },
    },
  ],
  report: {
    summary: "API",
    stack: ["TypeScript"],
    highlights: [],
    risks: [],
    suggestedProjects: [],
  },
  coverage: { files: ["README.md", "package.json"], topics: ["pagamentos"] },
};

describe("F03/M3 providers · ClaudeCodeProvider nas chamadas da ingestão", () => {
  const cases = [
    {
      name: "pickFiles",
      schema: INGEST_OUTPUT_JSON_SCHEMAS.pickFiles,
      out: { files: [{ path: "src/index.ts", reason: "entrada" }] },
      call: (p: ClaudeCodeProvider) =>
        p.pickFiles({
          repo: "ana-exemplo/api-pagamentos",
          tree: ["src/index.ts", "package.json"],
          candidates: ["src/index.ts"],
          maxFiles: 8,
          model: "haiku",
        }),
      prompt: () => PROMPTS.pickFiles(),
    },
    {
      name: "analyzeRepo",
      schema: INGEST_OUTPUT_JSON_SCHEMAS.analyzeRepo,
      out: ANALYZE_OUT,
      call: (p: ClaudeCodeProvider) =>
        p.analyzeRepo({ repo: "ana-exemplo/api-pagamentos", context: CONTEXT, model: "haiku" }),
      prompt: () => PROMPTS.analyzeRepo(),
    },
    {
      name: "synthesizeRun",
      schema: INGEST_OUTPUT_JSON_SCHEMAS.synthesizeRun,
      out: {
        skills: [],
        seniority: { level: "senior", rationale: "anos" },
        report: { summary: "ok", highlights: [], gaps: [] },
      },
      call: (p: ClaudeCodeProvider) =>
        p.synthesizeRun({
          reports: [{ fullName: "ana-exemplo/api-pagamentos", report: ANALYZE_OUT.report }],
          metricsTable: "commits: 10",
          model: "sonnet",
        }),
      prompt: () => PROMPTS.synthesizeRun(),
    },
    {
      name: "checkProposals",
      schema: INGEST_OUTPUT_JSON_SCHEMAS.checkProposals,
      out: { results: [{ proposalId: "p1", status: "supported" }] },
      call: (p: ClaudeCodeProvider) =>
        p.checkProposals({
          items: [{ proposalId: "p1", kind: "skill", claim: "skill: Go", quote: "Go" }],
          model: "haiku",
        }),
      prompt: () => PROMPTS.checkProposals(),
    },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: sem tools, até 3 turnos (correção da saída estruturada), modelo da entrada, outputFormat sem $schema, prompt próprio`, async () => {
      const query = fakeQuery([result(c.out)]);
      const p = new ClaudeCodeProvider({ exec, query, binaryPath: "/bin/claude" });
      const r = await c.call(p);
      expect(r.usage.inputTokens).toBe(120);
      const opts = query.captured[0]?.options as Record<string, unknown>;
      expect(opts.tools).toEqual([]);
      expect(opts.maxTurns).toBe(3);
      expect(opts.model).toBe(c.name === "synthesizeRun" ? "sonnet" : "haiku");
      expect(opts.outputFormat).toEqual({ type: "json_schema", schema: c.schema });
      expect(JSON.stringify(c.schema)).not.toContain("$schema");
      expect(opts.systemPrompt).toBe(c.prompt());
      expect(String(opts.systemPrompt).length).toBeGreaterThan(200);
    });
  }

  it("analyzeRepo põe o contexto empacotado no prompt e recusa saída fora do schema", async () => {
    const query = fakeQuery([result(ANALYZE_OUT)]);
    const p = new ClaudeCodeProvider({ exec, query, binaryPath: "/bin/claude" });
    await p.analyzeRepo({ repo: "ana-exemplo/api-pagamentos", context: CONTEXT, model: "haiku" });
    expect(query.captured[0]?.prompt).toContain("API de pagamentos em TypeScript");
    const bad = new ClaudeCodeProvider({
      exec,
      query: fakeQuery([result({ projects: [{ name: "x" }] })]),
      binaryPath: "/bin/claude",
    });
    await expect(
      bad.analyzeRepo({ repo: "a/b", context: CONTEXT, model: "haiku" }),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("prompts da ingestão pedem evidência literal e senioridades só do schema", () => {
    for (const k of ["analyzeRepo", "synthesizeRun", "extractFacts"] as const) {
      expect(PROMPTS[k]()).toMatch(/evidence/);
      expect(PROMPTS[k]()).toMatch(/literal/i);
    }
    expect(PROMPTS.synthesizeRun()).toMatch(/junior, pleno, senior, staff, manager ou director/);
  });
});

describe("F03/M3 providers · diagnóstico do plano (getPlanUsage)", () => {
  const rateLimitEvent: SdkMessageLike = {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed_warning",
      rateLimitType: "five_hour",
      utilization: 0.42,
      resetsAt: 1_791_000_000,
    },
  } as unknown as SdkMessageLike;

  it("usa a API experimental quando disponível e mapeia janelas e assinatura", async () => {
    const p = new ClaudeCodeProvider({
      exec,
      binaryPath: "/bin/claude",
      usageProbe: async () => ({
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 31, resets_at: "2026-10-09T18:00:00.000Z" },
          seven_day: { utilization: 12.5, resets_at: "2026-10-14T00:00:00.000Z" },
          seven_day_sonnet: { utilization: 9, resets_at: "2026-10-14T00:00:00.000Z" },
        },
      }),
    });
    const u = await p.getPlanUsage();
    expect(PlanUsageSchema.parse(u)).toEqual({
      subscription: "max",
      source: "usage_api",
      windows: {
        fiveHour: { utilization: 31, resetsAt: "2026-10-09T18:00:00.000Z" },
        sevenDay: { utilization: 12.5, resetsAt: "2026-10-14T00:00:00.000Z" },
        perModel: [{ model: "sonnet", utilization: 9, resetsAt: "2026-10-14T00:00:00.000Z" }],
      },
    });
  });

  it("captura o rate_limit_event do stream e cai nele quando a API experimental falha", async () => {
    const query = fakeQuery([rateLimitEvent, result({ files: [] })]);
    const p = new ClaudeCodeProvider({
      exec,
      query,
      binaryPath: "/bin/claude",
      usageProbe: async () => {
        throw new Error("método removido");
      },
    });
    await p.pickFiles({ repo: "a/b", tree: [], candidates: [], maxFiles: 8, model: "haiku" });
    const u = await p.getPlanUsage();
    expect(u?.source).toBe("rate_limit_event");
    expect(u?.windows.fiveHour?.utilization).toBe(42);
    expect(u?.windows.fiveHour?.resetsAt).toBe(new Date(1_791_000_000 * 1000).toISOString());
  });

  it("sem API e sem evento (API key, terceiros) devolve null", async () => {
    const p = new ClaudeCodeProvider({
      exec,
      binaryPath: "/bin/claude",
      usageProbe: async () => ({
        subscription_type: null,
        rate_limits_available: false,
        rate_limits: null,
      }),
    });
    expect(await p.getPlanUsage()).toBeNull();
  });

  it("mapSdkUsageResponse ignora janelas ausentes", () => {
    expect(
      mapSdkUsageResponse({
        subscription_type: "pro",
        rate_limits_available: true,
        rate_limits: { five_hour: null },
      })?.windows,
    ).toEqual({ fiveHour: null, sevenDay: null, perModel: [] });
  });
});

describe("F03/M3 providers · evidência literal no extractFacts do F01 (F03-12)", () => {
  it("o schema aceita evidência por item e a conversão separa propostas e evidências", () => {
    const out = ExtractFactsOutputSchema.parse({
      experiences: [
        {
          confidence: 0.9,
          company: "Acme Ltda",
          title: "Engenheira",
          startDate: "2021-03",
          isCurrent: true,
          tech: [],
          evidence: { ref: "cv", quote: "Acme Ltda — Engenheira" },
          achievements: [
            {
              confidence: 0.8,
              text: "Reduziu latência",
              evidence: { ref: "cv", quote: "latência" },
            },
          ],
        },
      ],
      education: [],
      skills: [{ confidence: 0.9, name: "Go", category: "language" }],
      languages: [],
      links: [],
    });
    const { proposals, evidence } = extractFactsOutputWithEvidence(out);
    expect(proposals.map((p) => p.kind)).toEqual(["experience", "achievement", "skill"]);
    expect(evidence).toEqual([
      { ref: "cv", quote: "Acme Ltda — Engenheira" },
      { ref: "cv", quote: "latência" },
      null,
    ]);
    expect(proposals[0]?.data).not.toHaveProperty("evidence");
  });

  it("o mock devolve trechos que existem de fato no texto recebido", async () => {
    const r = await new MockProvider().extractFacts({
      text: MOCK_CV_TEXT,
      locale: "pt-BR",
      model: "haiku",
    });
    const { evidence } = extractFactsOutputWithEvidence(r.output);
    const quotes = evidence.filter((e): e is NonNullable<typeof e> => Boolean(e));
    expect(quotes.length).toBeGreaterThan(5);
    for (const e of quotes) expect(MOCK_CV_TEXT).toContain(e.quote);
  });
});

describe("F03/M3 providers · MockProvider da ingestão", () => {
  it("pickFiles escolhe até o limite entre os candidatos", async () => {
    const r = await new MockProvider().pickFiles({
      repo: "a/b",
      tree: ["a", "b", "c"],
      candidates: ["c", "b", "a", "d", "e", "f", "g", "h", "i", "j"],
      maxFiles: 8,
      model: "haiku",
    });
    expect(PickFilesOutputSchema.parse(r.output).files.map((f) => f.path)).toHaveLength(8);
  });

  it("analyzeRepo cita trechos do contexto recebido; o modo `unsupportedEvidence` inventa um", async () => {
    const m = new MockProvider();
    const r = await m.analyzeRepo({
      repo: "ana-exemplo/api-pagamentos",
      context: CONTEXT,
      model: "haiku",
    });
    const out = AnalyzeRepoOutputSchema.parse(r.output);
    expect(out.projects[0]?.name).toBe("api-pagamentos");
    for (const item of [...out.projects, ...out.skills])
      expect(CONTEXT).toContain(item.evidence.quote);
    expect(out.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["TypeScript", "PostgreSQL"]),
    );
    m.setMode({ unsupportedEvidence: true });
    const bad = await m.analyzeRepo({
      repo: "ana-exemplo/api-pagamentos",
      context: CONTEXT,
      model: "haiku",
    });
    expect(bad.output.projects.some((p) => !CONTEXT.includes(p.evidence.quote))).toBe(true);
  });

  it("synthesizeRun e checkProposals respeitam os schemas; erros simulados por operação", async () => {
    const m = new MockProvider();
    const s = await m.synthesizeRun({
      reports: [{ fullName: "a/b", report: ANALYZE_OUT.report }],
      metricsTable: "commits: 1",
      model: "sonnet",
    });
    expect(SynthesizeRunOutputSchema.parse(s.output).report.summary).toMatch(/1 repositório/);
    const c = await m.checkProposals({
      items: [
        { proposalId: "p1", kind: "skill", claim: "skill: Go", quote: "Go" },
        { proposalId: "p2", kind: "skill", claim: "skill: Rust", quote: "linguagem Go" },
      ],
      model: "haiku",
    });
    expect(CheckProposalsOutputSchema.parse(c.output).results).toEqual([
      { proposalId: "p1", status: "supported" },
      { proposalId: "p2", status: "partial", note: "o trecho não cita o termo da proposta" },
    ]);
    m.setMode({ errors: { analyzeRepo: "falha simulada" } });
    await expect(
      m.analyzeRepo({ repo: "a/b", context: CONTEXT, model: "haiku" }),
    ).rejects.toMatchObject({
      code: "simulated",
    });
  });

  it("getPlanUsage devolve o snapshot fixo, controlável pelo modo (null = indisponível)", async () => {
    const m = new MockProvider();
    expect(await m.getPlanUsage()).toEqual(MOCK_PLAN_USAGE);
    m.setMode({ planUsage: null });
    expect(await m.getPlanUsage()).toBeNull();
    m.setMode({ planUsage: { ...MOCK_PLAN_USAGE, subscription: "pro" } });
    expect((await m.getPlanUsage())?.subscription).toBe("pro");
  });
});
