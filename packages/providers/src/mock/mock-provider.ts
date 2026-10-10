import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AnalyzeProfilesOutput,
  AnalyzeRepoOutput,
  BuildDigestOutput,
  CheckProposalsOutput,
  Evidence,
  ExtractFactsOutput,
  PickFilesOutput,
  PlanUsage,
  ReadDocumentOutput,
  SynthesizeRunOutput,
} from "@narnia-jobs/shared";
import {
  type AnalyzeProfilesProviderInput,
  type AnalyzeRepoInput,
  type AuthMethod,
  approxTokens,
  type BuildDigestInput,
  type CheckProposalsInput,
  type ExtractFactsInput,
  LOGIN_HINT,
  type PickFilesInput,
  type Provider,
  ProviderError,
  type ProviderResult,
  type ProviderStatus,
  type ReadDocumentInput,
  type SynthesizeRunInput,
} from "../provider";
import {
  MOCK_ANALYZE_PROFILES,
  MOCK_DIGEST,
  MOCK_EXTRACT_FACTS,
  MOCK_FAKE_QUOTE,
  MOCK_KNOWN_TECH,
  MOCK_PLAN_USAGE,
  MOCK_READ_DOCUMENT,
} from "./fixtures";

export type MockOperation =
  | "detect"
  | "readDocument"
  | "extractFacts"
  | "buildDigest"
  | "analyzeProfiles"
  | "pickFiles"
  | "analyzeRepo"
  | "synthesizeRun"
  | "checkProposals";

export interface MockProviderOptions {
  installed?: boolean;
  loggedIn?: boolean;
  authMethod?: Exclude<AuthMethod, "none">;
  version?: string;
  /** Atraso artificial por operação (modo `slow`). */
  delayMs?: number;
  /** Mensagem de erro por operação (modo `error`); ausente = sucesso. */
  errors?: Partial<Record<MockOperation, string>>;
  /** E2E-07 (F03): a primeira proposta de cada extração cita um trecho que não existe na fonte. */
  unsupportedEvidence?: boolean;
  /** Diagnóstico do plano devolvido por `getPlanUsage` (null = indisponível, como API key). */
  planUsage?: PlanUsage | null;
  /**
   * Arquivo JSON compartilhado entre processos (api e worker, F01-73): `setMode` grava, toda operação relê.
   * Sem arquivo, o modo fica só em memória.
   */
  modeFile?: string | null;
}

export type MockMode = Required<Omit<MockProviderOptions, "errors" | "modeFile" | "planUsage">> & {
  errors: Partial<Record<MockOperation, string>>;
  planUsage: PlanUsage | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Trecho literal da fonte que contém `needle` (sem diferenciar caixa): a linha inteira se couber em 200 chars,
 * senão uma janela em volta. `null` quando a fonte não contém o termo.
 */
export function quoteFrom(source: string, needle: string): string | null {
  const term = needle.trim();
  if (!term) return null;
  const re = new RegExp(
    /^[\w.]+$/u.test(term) && term.length <= 3 ? `\\b${escapeRe(term)}\\b` : escapeRe(term),
    "i",
  );
  for (const line of source.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const trimmed = line.trim();
    if (trimmed.length <= 200 && trimmed.length >= 3) return trimmed;
    const start = Math.max(0, m.index - 60);
    return line.slice(start, Math.min(line.length, m.index + m[0].length + 60)).trim();
  }
  return null;
}

function evidenceFor(source: string, ref: string, needle: string): Evidence {
  return { ref, quote: (quoteFrom(source, needle) ?? needle).slice(0, 600) };
}

const DEFAULT_MODE: MockMode = {
  installed: true,
  loggedIn: true,
  authMethod: "claude.ai",
  version: "2.1.292",
  delayMs: 0,
  errors: {},
  unsupportedEvidence: false,
  planUsage: MOCK_PLAN_USAGE,
};

function definedOnly(patch: MockProviderOptions): Partial<MockMode> {
  const { modeFile: _ignored, ...rest } = patch;
  return Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Partial<MockMode>;
}

/**
 * Provider de teste e desenvolvimento: nunca chama o modelo nem a assinatura. Modos controláveis em memória e,
 * com `modeFile`, compartilhados entre processos (a api recebe `POST /api/_test/mock`; o worker executa as etapas).
 */
export class MockProvider implements Provider {
  readonly id = "mock" as const;
  readonly modeFile: string | null;
  private mode: MockMode;

  constructor(options: MockProviderOptions = {}) {
    this.modeFile = options.modeFile ?? null;
    this.mode = { ...DEFAULT_MODE, ...definedOnly(options), errors: options.errors ?? {} };
  }

  /** Relê o arquivo compartilhado (se houver); arquivo ausente ou corrompido mantém o modo em memória. */
  private load(): void {
    if (!this.modeFile || !existsSync(this.modeFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.modeFile, "utf8")) as Partial<MockMode>;
      if (parsed && typeof parsed === "object") {
        this.mode = { ...DEFAULT_MODE, ...parsed, errors: parsed.errors ?? {} };
      }
    } catch {
      // JSON inválido: ignora e segue com o modo em memória
    }
  }

  private persist(): void {
    if (!this.modeFile) return;
    mkdirSync(dirname(this.modeFile), { recursive: true });
    writeFileSync(this.modeFile, JSON.stringify(this.mode), { mode: 0o600 });
  }

  getMode(): MockMode {
    this.load();
    return { ...this.mode, errors: { ...this.mode.errors } };
  }

  setMode(patch: MockProviderOptions): MockMode {
    this.load();
    this.mode = { ...this.mode, ...definedOnly(patch) } as MockMode;
    this.persist();
    return this.getMode();
  }

  /** Volta aos padrões (logado por volume, sem atraso, sem erros) e grava isso no arquivo compartilhado. */
  reset(): MockMode {
    this.mode = { ...DEFAULT_MODE, errors: {} };
    this.persist();
    return this.getMode();
  }

  private async gate(op: MockOperation): Promise<void> {
    this.load();
    if (this.mode.delayMs > 0) await sleep(this.mode.delayMs);
    const err = this.mode.errors[op];
    if (err) throw new ProviderError("simulated", err);
  }

  private result<T>(output: T, inputText: string, model: string): ProviderResult<T> {
    const inputTokens = Math.max(1, approxTokens(inputText) + 400);
    const outputTokens = Math.max(1, approxTokens(JSON.stringify(output)));
    return {
      output,
      usage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, model },
      costUsd: 0,
      sdk: { usage: { input_tokens: inputTokens, output_tokens: outputTokens }, total_cost_usd: 0 },
    };
  }

  async detect(): Promise<ProviderStatus> {
    await this.gate("detect");
    const { installed, loggedIn, authMethod, version } = this.mode;
    if (!installed) {
      return {
        installed: false,
        loggedIn: false,
        authMethod: "none",
        version: null,
        loginHint: LOGIN_HINT,
      };
    }
    if (!loggedIn) {
      return {
        installed: true,
        loggedIn: false,
        authMethod: "none",
        version,
        loginHint: LOGIN_HINT,
      };
    }
    return { installed: true, loggedIn: true, authMethod, version, loginHint: null };
  }

  async readDocument(input: ReadDocumentInput): Promise<ProviderResult<ReadDocumentOutput>> {
    await this.gate("readDocument");
    return this.result(structuredClone(MOCK_READ_DOCUMENT), input.filePath, input.model);
  }

  /** Fatos fixos com evidência buscada no texto recebido (F03-12): trecho literal quando o termo existe na fonte. */
  async extractFacts(input: ExtractFactsInput): Promise<ProviderResult<ExtractFactsOutput>> {
    await this.gate("extractFacts");
    const out = structuredClone(MOCK_EXTRACT_FACTS);
    const ev = (needle: string) => evidenceFor(input.text, "cv", needle);
    if (out.identity) out.identity.evidence = ev(out.identity.fullName ?? "");
    for (const exp of out.experiences) {
      exp.evidence = ev(exp.company);
      for (const a of exp.achievements) a.evidence = ev(a.text);
    }
    for (const e of out.education) e.evidence = ev(e.institution);
    for (const sk of out.skills) sk.evidence = ev(sk.name);
    for (const l of out.languages) l.evidence = ev(l.name);
    for (const l of out.links) l.evidence = ev(l.url.replace(/^https?:\/\//, ""));
    if (this.mode.unsupportedEvidence && out.experiences[0]) {
      out.experiences[0].evidence = { ref: "cv", quote: MOCK_FAKE_QUOTE };
    }
    return this.result(out, input.text, input.model);
  }

  async pickFiles(input: PickFilesInput): Promise<ProviderResult<PickFilesOutput>> {
    await this.gate("pickFiles");
    const pool = input.candidates.length > 0 ? input.candidates : input.tree;
    const output: PickFilesOutput = {
      files: pool
        .slice(0, input.maxFiles)
        .map((path) => ({ path, reason: "candidato da heurística" })),
    };
    return this.result(output, input.tree.join("\n"), input.model);
  }

  /** Projeto + skills reconhecidas no contexto, sempre citando trechos que existem nele (salvo `unsupportedEvidence`). */
  async analyzeRepo(input: AnalyzeRepoInput): Promise<ProviderResult<AnalyzeRepoOutput>> {
    await this.gate("analyzeRepo");
    const ctx = input.context;
    const name = input.repo.split("/").pop() ?? input.repo;
    const refs = [...ctx.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim());
    const firstLine =
      ctx
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length >= 10 && !l.startsWith("#")) ?? name;
    const tech = MOCK_KNOWN_TECH.filter(([t]) => quoteFrom(ctx, t) !== null);
    const output: AnalyzeRepoOutput = {
      projects: [
        {
          confidence: 0.85,
          name,
          description: firstLine.slice(0, 160),
          url: `https://github.com/${input.repo}`,
          tech: tech.map(([t]) => t),
          evidence: this.mode.unsupportedEvidence
            ? { ref: "README.md", quote: MOCK_FAKE_QUOTE }
            : { ref: refs[1] ?? "README.md", quote: firstLine.slice(0, 200) },
        },
      ],
      skills: tech.map(([t, category]) => ({
        confidence: 0.8,
        name: t,
        category,
        evidence: evidenceFor(ctx, "README.md", t),
      })),
      report: {
        summary: `Repositório ${input.repo} analisado pelo mock: ${firstLine.slice(0, 120)}`,
        stack: tech.map(([t]) => t),
        highlights: tech.length > 0 ? [`Usa ${tech.map(([t]) => t).join(", ")}`] : [],
        risks: /test/i.test(ctx) ? [] : ["Sem testes visíveis no contexto"],
        suggestedProjects: [`Documentar a arquitetura de ${name}`],
      },
      coverage: {
        files: refs.filter((r) => !r.startsWith("Repositório")),
        topics: ["visão geral"],
      },
    };
    return this.result(output, ctx, input.model);
  }

  async synthesizeRun(input: SynthesizeRunInput): Promise<ProviderResult<SynthesizeRunOutput>> {
    await this.gate("synthesizeRun");
    const n = input.reports.length;
    const seen = new Set<string>();
    const skills: SynthesizeRunOutput["skills"] = [];
    for (const r of input.reports) {
      for (const t of r.report.stack) {
        if (seen.has(t) || t.length < 3 || skills.length >= 5) continue;
        seen.add(t);
        const category = MOCK_KNOWN_TECH.find(([k]) => k === t)?.[1] ?? "other";
        skills.push({
          confidence: 0.7,
          name: t,
          category,
          evidence: { ref: r.fullName, quote: t },
        });
      }
    }
    const output: SynthesizeRunOutput = {
      skills,
      seniority: {
        level: "senior",
        rationale: "Trajetória consistente nos repositórios analisados (mock).",
      },
      report: {
        summary: `Síntese de ${n} ${n === 1 ? "repositório" : "repositórios"} pelo mock.`,
        highlights: input.reports.map((r) => r.fullName),
        gaps: [],
      },
    };
    return this.result(output, JSON.stringify(input.reports) + input.metricsTable, input.model);
  }

  /** Revisor: `supported` quando o trecho cita o termo da afirmação; senão `partial`. */
  async checkProposals(input: CheckProposalsInput): Promise<ProviderResult<CheckProposalsOutput>> {
    await this.gate("checkProposals");
    const output: CheckProposalsOutput = {
      results: input.items.map((it) => {
        const term = (it.claim.split(": ")[1] ?? it.claim).split(/ \(| —|, /)[0]?.trim() ?? "";
        return term && quoteFrom(it.quote, term) !== null
          ? { proposalId: it.proposalId, status: "supported" as const }
          : {
              proposalId: it.proposalId,
              status: "partial" as const,
              note: "o trecho não cita o termo da proposta",
            };
      }),
    };
    return this.result(output, JSON.stringify(input.items), input.model);
  }

  planWindowSnapshot(): { utilization: number | null; resetsAt: string | null } | null {
    const w = this.mode.planUsage?.windows.fiveHour;
    return w ? { utilization: w.utilization, resetsAt: w.resetsAt } : null;
  }

  async getPlanUsage(): Promise<PlanUsage | null> {
    this.load();
    return this.mode.planUsage ? structuredClone(this.mode.planUsage) : null;
  }

  /** Sugestões fixas (EM e Staff) citando as duas primeiras experiências da entrada como fatos de apoio. */
  async analyzeProfiles(
    input: AnalyzeProfilesProviderInput,
  ): Promise<ProviderResult<AnalyzeProfilesOutput>> {
    await this.gate("analyzeProfiles");
    const supporting = input.experiences.slice(0, 2).map((e) => e.id);
    const output: AnalyzeProfilesOutput = {
      suggestions: MOCK_ANALYZE_PROFILES.suggestions.map((s) => ({
        ...s,
        supportingFactIds: supporting,
      })),
    };
    const { model, ...rest } = input;
    return this.result(output, JSON.stringify(rest), model);
  }

  async buildDigest(input: BuildDigestInput): Promise<ProviderResult<BuildDigestOutput>> {
    await this.gate("buildDigest");
    return this.result(
      structuredClone(MOCK_DIGEST),
      input.text + JSON.stringify(input.proposals),
      input.model,
    );
  }
}
