import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AnalyzeProfilesOutput,
  AnalyzeRepoOutput,
  ApplicationAnswerOutput,
  ApplicationLocateOutput,
  BuildDigestOutput,
  ChatTitleOutput,
  CheckProposalsOutput,
  CoverLetterDraft,
  CvBrief,
  CvDraft,
  CvReviewOutput,
  Evidence,
  ExtractFactsOutput,
  PickFilesOutput,
  PlanUsage,
  PostingDuplicateOutput,
  PostingExtractOutput,
  PostingFields,
  PostingMergeOutput,
  ReadDocumentOutput,
  SynthesizeRunOutput,
} from "@narnia-jobs/shared";
import { type ChatEvent, type ChatHandle, type ChatOpenOptions, createAsyncQueue } from "../chat";
import {
  type AnalyzeProfilesProviderInput,
  type AnalyzeRepoInput,
  type ApplicationAnswerInput,
  type ApplicationLocateInput,
  type AuthMethod,
  approxTokens,
  type BuildDigestInput,
  type ChatTitleInput,
  type CheckProposalsInput,
  type CompleteInput,
  type CompleteResult,
  type CvGenerateInput,
  type CvReviewInput,
  type ExtractFactsInput,
  LOGIN_EXPIRED_HINT,
  LOGIN_HINT,
  type PickFilesInput,
  type PostingDuplicateInput,
  type PostingExtractInput,
  type PostingMergeInput,
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
  | "checkProposals"
  | "chatTitle"
  | "postingExtract"
  | "postingMerge"
  | "postingDuplicate"
  | "applicationLocate"
  | "applicationAnswer"
  | "cvGenerate"
  | "coverLetterGenerate"
  | "cvReview"
  | "complete"
  | "openChat";

export interface MockProviderOptions {
  installed?: boolean;
  loggedIn?: boolean;
  authMethod?: Exclude<AuthMethod, "none">;
  /** Com `loggedIn: false`: o login do volume expirou (credencial esvaziada), como o real detecta. */
  authExpired?: boolean;
  version?: string;
  /** Atraso artificial por operação (modo `slow`). */
  delayMs?: number;
  /** Mensagem de erro por operação (modo `error`); ausente = sucesso. */
  errors?: Partial<Record<MockOperation, string>>;
  /** E2E-07 (F03): a primeira proposta de cada extração cita um trecho que não existe na fonte. */
  unsupportedEvidence?: boolean;
  /** Diagnóstico do plano devolvido por `getPlanUsage` (null = indisponível, como API key). */
  planUsage?: PlanUsage | null;
  /** F05 e2e: quantas revisões de CV seguidas reprovam (o contador desce a cada revisão reprovada). */
  cvReviewFailures?: number;
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

/**
 * Linhas "Conquista: …" viram conquista de uma experiência do perfil (2026-10-14): a experiência cuja empresa aparece
 * na linha; sem empresa reconhecida, fica sem experiência (o usuário escolhe na revisão). Métrica = primeiro número.
 */
export function mockProfileAchievements(
  input: ExtractFactsInput,
): NonNullable<ExtractFactsOutput["profileAchievements"]> {
  return [...input.text.matchAll(/^\s*Conquista:\s*(.+?)\s*$/gim)].map((m) => {
    const text = m[1] ?? "";
    const exp = (input.experiences ?? []).find((e) =>
      text.toLowerCase().includes(e.company.toLowerCase()),
    );
    const metric = text.match(/\d+(?:[.,]\d+)?\s*\p{L}*/u)?.[0];
    return {
      confidence: 0.8,
      text,
      ...(exp ? { experienceId: exp.id } : {}),
      ...(metric ? { metric } : {}),
      evidence: { ref: "text", quote: (m[0] ?? text).trim().slice(0, 600) },
    };
  });
}

function evidenceFor(source: string, ref: string, needle: string): Evidence {
  return { ref, quote: (quoteFrom(source, needle) ?? needle).slice(0, 600) };
}

const DEFAULT_MODE: MockMode = {
  installed: true,
  loggedIn: true,
  authMethod: "claude.ai",
  authExpired: false,
  version: "2.1.292",
  delayMs: 0,
  errors: {},
  unsupportedEvidence: false,
  planUsage: MOCK_PLAN_USAGE,
  cvReviewFailures: 0,
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
    const { installed, loggedIn, authMethod, authExpired, version } = this.mode;
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
        loginHint: authExpired ? LOGIN_EXPIRED_HINT : LOGIN_HINT,
        ...(authExpired ? { authExpired: true } : {}),
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
    // salário, carga e contrato declarados no texto (campos de 2026-10-13) vão para a experiência mais recente
    const pay = mockCompensation(input.text);
    if (pay && out.experiences[0]) {
      Object.assign(out.experiences[0], pay.fields);
      out.experiences[0].evidence = { ref: "cv", quote: pay.quote };
    }
    if (this.mode.unsupportedEvidence && out.experiences[0]) {
      out.experiences[0].evidence = { ref: "cv", quote: MOCK_FAKE_QUOTE };
    }
    out.profileAchievements = mockProfileAchievements(input);
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

  /**
   * Título previsível para testes (o real é o objetivo da mensagem, escolhido pelo haiku): as primeiras palavras, sem
   * o marcador de anexo, com a inicial maiúscula.
   */
  async chatTitle(input: ChatTitleInput): Promise<ProviderResult<ChatTitleOutput>> {
    await this.gate("chatTitle");
    const words = input.message
      .replace(/\[anexo: [^\]]*\]/g, " ")
      .replace(/[^\p{L}\p{N}$%.,/ -]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5);
    const text = words
      .join(" ")
      .replace(/[.,?!]+$/, "")
      .slice(0, 60)
      .trim();
    const title =
      words.length >= 2
        ? `${text.charAt(0).toUpperCase()}${text.slice(1)}`
        : "Conversa com o recrutador";
    return this.result({ title }, input.message, input.model);
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

  /** Ponte da assinatura (M1): eco determinístico do pedido; com schema, o menor objeto válido. */
  async complete(input: CompleteInput, onText?: (text: string) => void): Promise<CompleteResult> {
    await this.gate("complete");
    const structured = input.jsonSchema ? minimalFromSchema(input.jsonSchema) : null;
    const text =
      structured !== null
        ? JSON.stringify(structured)
        : `Resposta simulada (mock) para: ${input.prompt.slice(0, 200)}`;
    for (const piece of text.match(/.{1,40}/gs) ?? [text]) onText?.(piece);
    const inputTokens = approxTokens(input.system) + approxTokens(input.prompt);
    return {
      text,
      structured,
      model: input.model,
      usage: {
        inputTokens,
        outputTokens: approxTokens(text),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: input.model,
      },
      costUsd: 0,
    };
  }

  /**
   * Chat com roteiros (F04 M3): o "modelo" é falso, mas as tools são reais: cada turno chama uma tool do `/mcp` do app
   * pelo JSON-RPC com os headers da sessão (token e `X-Narnia-Session`) e responde em fragmentos. Roteiro pela mensagem:
   * clarificação → `ingest_propose`; salário/mercado/pesquisa → `research_save`; "texto:"/história → `ingest_text`;
   * anexo do composer → `ingest_file`; "pode usar" → `research_apply` com a fonte mais recente; "confirmo <runId>" →
   * `ingest_confirm`; o resto → `evidence_experience_list`.
   */
  openChat(opts: ChatOpenOptions): ChatHandle {
    const out = createAsyncQueue<ChatEvent>();
    const providerSessionId = opts.resume ?? `mock-${randomUUID()}`;
    out.push({ type: "init", providerSessionId });
    const fetchFn = opts.fetch ?? fetch;
    let rpcId = 0;
    let chain: Promise<void> = Promise.resolve();
    const callTool = async (name: string, args: Record<string, unknown>) => {
      const res = await fetchFn(opts.mcp.url, {
        method: "POST",
        headers: {
          ...opts.mcp.headers,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++rpcId,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const raw = await res.text();
      const body = parseRpcBody(raw);
      const result = body?.result as
        | { content?: Array<{ text?: string }>; isError?: boolean }
        | undefined;
      return {
        text: result?.content?.[0]?.text ?? raw.slice(0, 300),
        isError: !res.ok || result?.isError === true || body?.error !== undefined,
      };
    };
    // "Parar" (auditoria B): como o CLI, o turno cortado termina com um result de interrupção, nunca com erro
    let running = false;
    let aborted = false;
    const interrupted = (text: string) =>
      out.push({
        type: "turn_end",
        text,
        providerSessionId,
        costUsd: 0,
        usage: emptyUsage(opts.model),
        interrupted: true,
      });
    /** Uma tool do roteiro com os eventos que o CLI emitiria (início, fim) e o texto devolvido. */
    const step = async (name: string, args: Record<string, unknown>) => {
      const id = `mock-tool-${++rpcId}`;
      const input = JSON.stringify(args);
      out.push({ type: "tool_start", id, name, args: input.slice(0, 500), input });
      const r = await callTool(name, args);
      out.push({ type: "tool_end", id, isError: r.isError, output: r.text });
      if (r.isError) throw new Error(`${name}: ${r.text}`);
      return JSON.parse(r.text) as Record<string, unknown>;
    };
    const analyzePosting = async (postingId: string) => {
      const posting = await step("posting_get", { id: postingId });
      const profiles = (
        (await step("profile_list", {})) as { profiles: Array<{ id: string; name: string }> }
      ).profiles;
      const skills = (
        (await step("evidence_skill_list", { limit: 3 })) as {
          items: Array<{ id: string; line: string }>;
        }
      ).items;
      const fields = (posting.fields ?? {}) as Record<string, unknown>;
      const recommended = profiles[0]?.id ?? "sem-perfil";
      await step("analysis_save", {
        postingId,
        analysis: {
          summary: "Aderência boa ao perfil recomendado, com lacunas em nuvem.",
          profiles: profiles.map((p, i) => ({
            profileId: p.id,
            fit: Math.max(40, 78 - i * 15),
            rationale: `Experiências do perfil ${p.name} cobrem a maior parte dos requisitos.`,
            confidence: "medium",
          })),
          recommendedProfileId: recommended,
          recommendationRationale: "Mais experiências ligadas aos requisitos obrigatórios.",
          matches: skills.slice(0, 2).map((sk) => ({
            requirement: sk.line.split(" · ")[0] ?? sk.line,
            evidence: [{ kind: "skill", id: sk.id }],
            strength: "strong",
          })),
          gaps: [
            {
              requirement: "AWS",
              severity: "important",
              evidenceChecked: true,
              suggestion: "Citar projetos em nuvem ou estudar AWS.",
            },
            {
              requirement: "Kafka",
              severity: "minor",
              evidenceChecked: true,
              suggestion: "Mostrar experiência com mensageria.",
            },
          ],
          risks: [
            {
              type: "salary",
              description: "Faixa da vaga perto do mínimo do perfil.",
              source: "model",
            },
          ],
          atsKeywordsMissing: [{ term: "Kafka", where: "skills" }],
          likelyQuestions: [
            {
              question: "Conte um incidente que você resolveu.",
              why: "Vaga pede sustentação.",
              evidence: [],
            },
          ],
          studyRecommendations: [{ topic: "AWS", why: "Diferencial da vaga." }],
          cvImprovements: [
            { suggestion: "Pôr métricas nas conquistas.", why: "A vaga valoriza impacto." },
          ],
          seniority: {
            asked: (fields.seniority as string | undefined) ?? null,
            profile: "senior",
            note: "Compatível.",
          },
        },
      });
      const reply = `Análise gravada (fonte: analysis_save): fit de ${Math.max(40, 78)} no perfil ${profiles[0]?.name ?? ""}. Maiores lacunas: AWS e Kafka. Quer ver a página da vaga?`;
      for (const piece of reply.match(/[^ ]+ ?/g) ?? [reply])
        out.push({ type: "delta", text: piece });
      out.push({
        type: "turn_end",
        text: reply,
        providerSessionId,
        costUsd: 0,
        usage: { ...emptyUsage(opts.model), inputTokens: 900, outputTokens: 300 },
      });
    };
    const openPostingAnalysis = async (jd: string) => {
      const url = /^https?:\/\/\S+$/.test(jd) ? jd : undefined;
      const created = (await step("posting_create", url ? { url } : { text: jd })) as {
        postingId: string;
        title: string;
      };
      const opened = (await step("posting_open_analysis", { postingId: created.postingId })) as {
        title: string;
      };
      const reply = `Salvei a vaga e abri a conversa "${opened.title}" para a análise; ela já está rodando lá.`;
      for (const piece of reply.match(/[^ ]+ ?/g) ?? [reply])
        out.push({ type: "delta", text: piece });
      out.push({
        type: "turn_end",
        text: reply,
        providerSessionId,
        costUsd: 0,
        usage: { ...emptyUsage(opts.model), inputTokens: 500, outputTokens: 80 },
      });
    };
    const turn = async (text: string) => {
      running = true;
      aborted = false;
      try {
        await this.gate("openChat");
        if (aborted) return interrupted("");
        // análise de vaga (F06): o mock percorre o procedimento da skill (ler a vaga, perfis, evidências, gravar)
        const job = /^\(nota do sistema: esta conversa é a análise da vaga ([^\s(]+)/.exec(text);
        if (job) return await analyzePosting(job[1] as string);
        // pedido de análise numa conversa comum: salva a vaga e abre a conversa própria dela (F06 §1.1)
        const ask = /analis[ae]\s+(?:esta|essa|a)\s+vaga[:\s]+([\s\S]+)/i.exec(text);
        if (ask && opts.category !== "job")
          return await openPostingAnalysis((ask[1] as string).trim());
        const [tool, args] = mockChatScript(text, opts);
        // a fonte que o usuário aprovou é a última registrada (o modelo real leria de research_list)
        if (args.sourceId === LATEST_RESEARCH) {
          const listed = await callTool("research_list", { limit: 1 });
          const first = (() => {
            try {
              return (JSON.parse(listed.text) as { items?: Array<{ id: string }> }).items?.[0]?.id;
            } catch {
              return undefined;
            }
          })();
          args.sourceId = first ?? "sem-fonte";
        }
        if (args.id === FIRST_EXPERIENCE) {
          const listed = await callTool("evidence_experience_list", { limit: 1 });
          try {
            args.id =
              (JSON.parse(listed.text) as { items?: Array<{ id: string }> }).items?.[0]?.id ??
              "sem-experiencia";
          } catch {
            args.id = "sem-experiencia";
          }
        }
        const id = `mock-tool-${++rpcId}`;
        const input = JSON.stringify(args);
        // uma "chamada ao modelo" antes da tool e outra para a resposta, como o CLI (rastro por passo)
        const step = (outputTokens: number): ChatEvent => ({
          type: "llm_message",
          messageId: `mock-msg-${++rpcId}`,
          model: opts.model,
          usage: {
            inputTokens: approxTokens(opts.systemPrompt) + approxTokens(text),
            outputTokens,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: opts.model,
          },
        });
        out.push(step(approxTokens(input)));
        out.push({ type: "tool_start", id, name: tool, args: input.slice(0, 500), input });
        // subagente (F06-8): o mock não roda outro agente; devolve a análise fixa do especializado
        const r =
          tool === "Agent"
            ? { text: MOCK_SPECIALIST_REPORT, isError: false }
            : await callTool(tool, args);
        out.push({ type: "tool_end", id, isError: r.isError, output: r.text });
        if (aborted) return interrupted("");
        const reply = mockChatReply(tool, r.isError);
        out.push(step(approxTokens(reply)));
        for (const piece of reply.match(/[^ ]+ ?/g) ?? [reply])
          out.push({ type: "delta", text: piece });
        out.push({
          type: "turn_end",
          text: reply,
          providerSessionId,
          costUsd: 0,
          usage: {
            inputTokens:
              approxTokens(opts.systemPrompt) + approxTokens(text) + approxTokens(r.text) + 400,
            outputTokens: approxTokens(reply),
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: opts.model,
          },
        });
      } catch (e) {
        out.push({ type: "error", message: (e as Error).message });
      } finally {
        running = false;
      }
    };
    return {
      send(text) {
        chain = chain.then(() => turn(text));
      },
      events: out.iterable,
      async interrupt() {
        if (running) aborted = true;
      },
      async setModel() {},
      close() {
        out.end();
      },
    };
  }

  /**
   * Extração previsível para testes (F06): título na 1ª linha, empresa e cliente pelos rótulos "Empresa:"/"Cliente:"
   * (ou o trecho antes de "·" na 2ª linha), role e senioridade por palavras do título, termos conhecidos como
   * obrigatórios. O real lê a vaga inteira.
   */
  async postingExtract(input: PostingExtractInput): Promise<ProviderResult<PostingExtractOutput>> {
    await this.gate("postingExtract");
    const lines = input.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const label = (re: RegExp) => re.exec(input.text)?.[1]?.trim() ?? null;
    const second = lines[1]?.split("·")[0]?.trim() || null;
    const title = lines[0] && lines[0].length <= 90 ? lines[0] : null;
    const t = input.text.toLowerCase();
    const fields: PostingFields = {
      ...EMPTY_POSTING_FIELDS,
      company: label(/(?:empresa|company)\s*:\s*([^\n·|]+)/i) ?? second,
      client: label(/(?:cliente|client)\s*:\s*([^\n·|]+)/i),
      title,
      role: /back-?end/.test(t) ? "backend" : /front-?end/.test(t) ? "frontend" : null,
      seniority: /s[eê]nior|senior/.test(t) ? "senior" : /pleno/.test(t) ? "pleno" : null,
      workMode: /remot/.test(t)
        ? "remote"
        : /h[ií]brid/.test(t)
          ? "hybrid"
          : /presencial/.test(t)
            ? "onsite"
            : null,
      contractType: /\bclt\b/.test(t) ? "clt" : /\bpj\b/.test(t) ? "pj" : null,
    };
    const keywords = MOCK_POSTING_TERMS.filter((k) => t.includes(k.toLowerCase())).map((term) => ({
      term,
      section: "required" as const,
    }));
    return this.result({ fields, keywords }, input.text, input.model);
  }

  /** Merge previsível: o valor do modelo vence quando existe; origem `both` quando os dois concordam. */
  async postingMerge(input: PostingMergeInput): Promise<ProviderResult<PostingMergeOutput>> {
    await this.gate("postingMerge");
    const h = input.heuristic.fields as Partial<Record<keyof PostingFields, unknown>>;
    const m = input.extracted.fields as Record<keyof PostingFields, unknown>;
    const fields = { ...EMPTY_POSTING_FIELDS } as Record<keyof PostingFields, unknown>;
    const fieldSources: PostingMergeOutput["fieldSources"] = [];
    const filled = (v: unknown) =>
      v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
    for (const k of Object.keys(EMPTY_POSTING_FIELDS) as Array<keyof PostingFields>) {
      if (k === "jdText") continue;
      const hv = h[k];
      const mv = m[k];
      if (filled(mv)) {
        fields[k] = mv;
        fieldSources.push({
          field: k,
          source: JSON.stringify(hv) === JSON.stringify(mv) ? "both" : "model",
        });
      } else if (filled(hv)) {
        fields[k] = hv;
        fieldSources.push({ field: k, source: "heuristic" });
      }
    }
    const byTerm = new Map<string, PostingMergeOutput["keywords"][number]>();
    for (const k of input.heuristic.keywords)
      byTerm.set(k.term, {
        term: k.term,
        section: (["required", "nice", "other"].includes(k.section)
          ? k.section
          : "other") as "required",
        source: "heuristic",
      });
    for (const k of input.extracted.keywords) {
      const cur = byTerm.get(k.term);
      byTerm.set(k.term, cur ? { ...cur, source: "both" } : { ...k, source: "model" });
    }
    return this.result(
      { fields: fields as PostingFields, fieldSources, keywords: [...byTerm.values()] },
      input.text,
      input.model,
    );
  }

  /**
   * Localizador previsível (F12/M3): uma pergunta por campo, pelo rótulo, com o tipo pelo campo; "buscar" e "CEP" vão
   * para `ignored` (o real junta rótulos quebrados e entende o sentido).
   */
  async applicationLocate(
    input: ApplicationLocateInput,
  ): Promise<ProviderResult<ApplicationLocateOutput>> {
    await this.gate("applicationLocate");
    const KIND: Record<string, ApplicationLocateOutput["questions"][number]["kind"]> = {
      textarea: "long_text",
      richtext: "long_text",
      select: "choice",
      radio: "choice",
      combobox: "choice",
      multiselect: "multi_choice",
      checkboxes: "multi_choice",
      checkbox: "yes_no",
      number: "number",
      date: "date",
      file: "file",
    };
    const ignored = input.fields.filter((f) => /buscar|search|\bcep\b/i.test(f.label ?? ""));
    const questions = input.fields
      .filter((f) => !ignored.includes(f))
      .map((f) => ({
        fieldRefs: [f.ref],
        question: (f.label ?? f.placeholder ?? f.name ?? "Campo").replace(/\s*\*\s*$/, ""),
        kind: KIND[f.control] ?? ("short_text" as const),
        required: f.required,
        section: f.section,
        topic: null,
      }));
    return this.result(
      { questions, ignored: ignored.map((f) => f.ref) },
      JSON.stringify(input.fields),
      input.model,
    );
  }

  /**
   * Respostas previsíveis (F12/M4): texto cita a primeira experiência do resumo (com a origem), escolha pega a primeira
   * opção, número fica como lacuna (o real calcula pelas datas quando dá).
   */
  async applicationAnswer(
    input: ApplicationAnswerInput,
  ): Promise<ProviderResult<ApplicationAnswerOutput>> {
    await this.gate("applicationAnswer");
    const exp = input.brief.experiences[0];
    const en = input.locale.startsWith("en");
    const answers = input.questions.map((q) => {
      if (q.options.length)
        return { questionId: q.questionId, answer: q.options[0] as string, origins: [], gap: null };
      if (q.kind === "yes_no")
        return { questionId: q.questionId, answer: en ? "Yes" : "Sim", origins: [], gap: null };
      if (q.kind === "number" || !exp)
        return {
          questionId: q.questionId,
          answer: null,
          origins: [],
          gap: en ? "The data does not say." : "Os dados não dizem isso.",
        };
      return {
        questionId: q.questionId,
        answer: en
          ? `At ${exp.company} I worked as ${exp.title}.`
          : `Na ${exp.company}, trabalhei como ${exp.title}.`,
        origins: [exp.id],
        gap: null,
      };
    });
    return this.result({ answers }, JSON.stringify(input.questions), input.model);
  }

  /** Duplicata previsível: JD igual (sem espaços e caixa) = mesma vaga com 95%; diferente = 55%, com as diferenças. */
  async postingDuplicate(
    input: PostingDuplicateInput,
  ): Promise<ProviderResult<PostingDuplicateOutput>> {
    await this.gate("postingDuplicate");
    const norm = (t: string | null) => (t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const same = norm(input.saved.jdText) === norm(input.incoming.jdText);
    const a = input.saved.fields as Record<string, unknown>;
    const b = input.incoming.fields as Record<string, unknown>;
    const show = (v: unknown) => (v === null || v === undefined ? "não informado" : String(v));
    const differences = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .slice(0, 8)
      .map((field) => ({ field, saved: show(a[field]), incoming: show(b[field]) }));
    if (!same && norm(input.saved.jdText) && norm(input.incoming.jdText))
      differences.unshift({ field: "descrição", saved: "texto anterior", incoming: "texto novo" });
    return this.result(
      {
        sameJob: same || differences.length <= 1,
        confidence: same ? 95 : 55,
        differences,
        rationale: same
          ? "Mesma descrição da vaga salva."
          : "Mesma empresa e cargo, mas a descrição mudou; confira as diferenças.",
      },
      JSON.stringify(input),
      input.model,
    );
  }

  /**
   * CV previsível (F05): bullets das conquistas do resumo (texto + métrica, com a origem), tecnologias de cada
   * experiência sem os termos de `gaps`, skills num grupo só. Nunca escreve um termo sem evidência.
   */
  async cvGenerate(input: CvGenerateInput): Promise<ProviderResult<CvDraft>> {
    await this.gate("cvGenerate");
    const b = input.brief;
    const en = b.locale === "en-US";
    const gaps = new Set(b.gaps.map((g) => g.toLowerCase()));
    const clean = (list: string[]) => list.filter((t) => !gaps.has(t.toLowerCase()));
    const experiences = b.experiences.slice(0, 4).map((e, i) => {
      const ach = e.achievements.slice(0, i === 0 ? 3 : 2);
      const bullets = ach.length
        ? ach.map((a) => ({
            text: a.metric ? `${a.text} (${a.metric}).` : `${a.text}.`,
            factIds: [{ kind: "achievement" as const, id: a.id }],
          }))
        : [
            {
              text:
                e.summary ?? (en ? `${e.title} at ${e.company}.` : `${e.title} na ${e.company}.`),
              factIds: [{ kind: "experience" as const, id: e.id }],
            },
          ];
      // o mock não traduz: cargo e local como nos dados
      return {
        factId: e.id,
        title: e.title,
        location: null,
        bullets,
        tech: clean(e.tech).slice(0, 6),
      };
    });
    const skills = clean(b.skills.map((s) => s.name)).slice(0, 12);
    const draft: CvDraft = {
      headline: b.profile.targetTitle,
      education: [],
      summary: en
        ? `${b.profile.targetTitle} focused on ${skills.slice(0, 3).join(", ")}.`
        : `${b.profile.targetTitle} com foco em ${skills.slice(0, 3).join(", ")}.`,
      experiences,
      skills: skills.length
        ? [
            {
              label: en ? "Skills" : "Habilidades",
              items: b.skills
                .filter((s) => skills.includes(s.name))
                .map((s) => ({ name: s.name, factIds: [{ kind: "skill" as const, id: s.id }] })),
            },
          ]
        : [],
      projects: [],
      adjacent: [],
      sectionsOrder: ["summary", "experience", "skills", "education", "languages"],
    };
    return this.result(draft, JSON.stringify(b), input.model);
  }

  /** Carta previsível (F05-21): quatro parágrafos de ~75 palavras; lacunas só no parágrafo delas. */
  async coverLetterGenerate(input: CvGenerateInput): Promise<ProviderResult<CoverLetterDraft>> {
    await this.gate("coverLetterGenerate");
    const b: CvBrief = input.brief;
    const en = b.locale === "en-US";
    const company = b.posting?.company ?? (en ? "the team" : "o time");
    const fill = (base: string) => {
      const words: string[] = [];
      while (words.length < 75) words.push(...base.split(" "));
      return `${words.slice(0, 75).join(" ")}.`;
    };
    const ach = b.experiences.flatMap((e) => e.achievements).slice(0, 2);
    const draft: CoverLetterDraft = {
      headline: b.profile.targetTitle,
      greeting: en ? `Dear ${company} team,` : `Olá, time da ${company},`,
      paragraphs: [
        {
          role: "why",
          text: fill(
            en
              ? `I am applying for the ${b.posting?.title ?? "open"} role`
              : `Me candidato à vaga de ${b.posting?.title ?? "aberta"}`,
          ),
          factIds: [],
        },
        {
          role: "covers",
          text: fill(ach.map((a) => a.text).join(" ") || b.profile.targetTitle),
          factIds: ach.length
            ? ach.map((a) => ({ kind: "achievement" as const, id: a.id }))
            : [{ kind: "experience" as const, id: b.experiences[0]?.id ?? "x" }],
        },
        {
          role: "gaps",
          text: fill(
            en
              ? `I am eager to learn ${b.gaps.slice(0, 2).join(" and ") || "new tools"}`
              : `Quero aprender ${b.gaps.slice(0, 2).join(" e ") || "novas ferramentas"}`,
          ),
          factIds: [],
        },
        {
          role: "closing",
          text: fill(
            en
              ? "Thank you for your time and I look forward to talking"
              : "Obrigada pelo tempo e fico à disposição para conversar",
          ),
          factIds: [],
        },
      ],
    };
    return this.result(draft, JSON.stringify(b), input.model);
  }

  /** Revisão previsível (F05-13): aprova, a não ser que o modo peça N reprovações seguidas (`cvReviewFailures`). */
  async cvReview(input: CvReviewInput): Promise<ProviderResult<CvReviewOutput>> {
    await this.gate("cvReview");
    let out: CvReviewOutput = { passed: true, issues: [] };
    if (this.mode.cvReviewFailures > 0) {
      this.mode = { ...this.mode, cvReviewFailures: this.mode.cvReviewFailures - 1 };
      this.persist();
      out = {
        passed: false,
        issues: [
          {
            area: "layout",
            severity: "error",
            message: "Simulação: texto sobreposto no cabeçalho da página 1.",
            where: "página 1",
          },
        ],
      };
    }
    return this.result(out, input.pdfText, input.model);
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

/** Corpo da resposta do `/mcp`: JSON (modo `enableJsonResponse`) ou SSE com linhas `data:`. */
function parseRpcBody(raw: string): { result?: unknown; error?: unknown } | null {
  const tryJson = (t: string) => {
    try {
      return JSON.parse(t) as { result?: unknown; error?: unknown };
    } catch {
      return null;
    }
  };
  const direct = tryJson(raw);
  if (direct) return direct;
  for (const line of raw.split("\n"))
    if (line.startsWith("data:")) return tryJson(line.slice(5).trim());
  return null;
}

/** Roteiro do mock: qual tool chamar para a mensagem (e com que argumentos válidos). */
export function mockChatScript(
  text: string,
  opts: Pick<ChatOpenOptions, "category" | "ingestionRunId" | "agents">,
): [string, Record<string, unknown>] {
  // aviso de ingestão pronta (2026-10-13): o modelo real só avisa; o mock usa uma tool de leitura, nunca abre ingestão
  if (text.startsWith("(nota do sistema: a ingestão")) return ["evidence_experience_list", {}];
  // entrevista de descoberta (auditoria E2): o 1º turno (com a nota do sistema) e respostas curtas olham as lacunas;
  // um relato de 200+ caracteres vai para a revisão por ingest_text, como a orientação do plugin pede
  if (opts.category === "discovery")
    return text.length >= 200 && !text.startsWith("(nota do sistema")
      ? ["ingest_text", { text }]
      : ["fact_gaps", {}];
  if (opts.category === "clarify" && opts.ingestionRunId)
    return [
      "ingest_propose",
      {
        runId: opts.ingestionRunId,
        proposals: [
          {
            proposal: {
              kind: "skill",
              confidence: 0.7,
              data: { name: "Comunicação com stakeholders", category: "soft" },
            },
            evidence: { ref: "conversa", quote: text.slice(0, 200) || "resposta do usuário" },
          },
        ],
      },
    ];
  if (/fora da lista|blog/i.test(text))
    return [
      "research_save",
      {
        url: "https://blog.exemplo-nao-confiavel.com/salarios-2026",
        title: "Blog qualquer · salários",
        excerpt: "Tabela de salários sem metodologia publicada.",
        usedFor: "salary",
      },
    ];
  const attached = /\[anexo: [^\]]* · fileId ([0-9A-Za-z-]+)\]/.exec(text);
  if (attached) return ["ingest_file", { fileId: attached[1] as string }];
  const confirm =
    /confirm\w*\b.*?\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(text);
  if (confirm) return ["ingest_confirm", { runId: confirm[1] as string }];
  if (/pode usar|usar esse valor|usar este valor/i.test(text)) {
    // "12 a 16 mil": o "mil" vale para os dois números
    const thousands = /\d\s*(mil|k)\b/i.test(text);
    const [min, max] = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => {
      const n = Number(m[0].replace(",", "."));
      return thousands && n < 1000 ? n * 1000 : n;
    });
    return [
      "research_apply",
      {
        field: "salary",
        sourceId: LATEST_RESEARCH,
        salary: {
          min: min ?? 12000,
          max: max ?? min ?? 16000,
          currency: "BRL",
          period: "monthly",
        },
      },
    ];
  }
  // alteração pequena pedida na conversa: vira uma proposta para o usuário confirmar, nunca grava direto
  const role = /meu cargo .*? era ([^,.!?]+)/i.exec(text);
  if (role)
    return [
      "fact_propose_change",
      {
        kind: "experience",
        id: FIRST_EXPERIENCE,
        changes: { title: (role[1] as string).trim() },
        reason: "O usuário corrigiu o cargo na conversa.",
        quote: text.trim().slice(0, 600),
      },
    ];
  const file = /^arquivo:\s*(\S+)/i.exec(text);
  if (file) return ["ingest_file", { fileId: file[1] as string }];
  const github = /^github:\s*(\S+)/i.exec(text);
  if (github)
    return ["ingest_github", { mode: "public", repos: [github[1] as string], depth: "quick" }];
  if (/sal[aá]rio|mercado|pesquis/i.test(text))
    return [
      "research_save",
      {
        url: "https://www.ibge.gov.br/explica/desemprego.php",
        title: "IBGE · Rendimento médio do trabalho",
        excerpt: "Rendimento médio real habitual das pessoas ocupadas (fonte oficial).",
        usedFor: "salary",
      },
    ];
  // recrutador especializado (F06-8): comparação entre perfis e análises dirigidas vão para o subagente
  if (
    opts.agents?.["recrutador-especializado"] &&
    /qual (dos meus )?perfi|perfil mais indicado|especializad/i.test(text)
  )
    return [
      "Agent",
      {
        subagent_type: "recrutador-especializado",
        description: "Análise dirigida a um perfil",
        prompt: `profileId: (do cartão) · objetivo: ${text.slice(0, 200)}`,
      },
    ];
  if (/^texto:|minha hist[oó]ria|ingira|ingest/i.test(text))
    return ["ingest_text", { text: text.replace(/^texto:\s*/i, "") }];
  return ["evidence_experience_list", {}];
}

/** Resposta fixa do recrutador especializado no mock (o real roda o subagente). */
const MOCK_SPECIALIST_REPORT =
  "Conclusão: aderência alta ao perfil, com evidências em experiências de backend (experience). Lacuna: nenhuma métrica de liderança.";

/** Vaga vazia (F06): todos os campos, nada preenchido. */
const EMPTY_POSTING_FIELDS: PostingFields = {
  company: null,
  client: null,
  title: null,
  role: null,
  seniority: null,
  city: null,
  state: null,
  country: null,
  workMode: null,
  contractType: null,
  currency: null,
  salaryMin: null,
  salaryMax: null,
  salaryPeriod: null,
  benefits: [],
  responsibilities: [],
  skillsRequired: [],
  skillsNice: [],
  companySummary: null,
  postingUrl: null,
  companyUrl: null,
  jdText: null,
  publishedAt: null,
};

/** Termos que a extração do mock reconhece (o real lê a vaga inteira). */
const MOCK_POSTING_TERMS = [
  "Node.js",
  "TypeScript",
  "PostgreSQL",
  "Kubernetes",
  "AWS",
  "Java",
  "Kafka",
  "React",
  "Python",
  "Docker",
];

/** Marcador do roteiro: troca pelo id da fonte mais recente antes de chamar `research_apply`. */
const LATEST_RESEARCH = "__fonte_mais_recente__";
/** Marcador do roteiro: troca pelo id da primeira experiência da lista antes de chamar `fact_propose_change`. */
const FIRST_EXPERIENCE = "__primeira_experiencia__";

function emptyUsage(model: string) {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model };
}

function mockChatReply(tool: string, isError: boolean): string {
  if (isError)
    return `Tentei usar ${tool}, mas a ferramenta respondeu com erro; me conte de outro jeito ou tente de novo.`;
  const byTool: Record<string, string> = {
    evidence_experience_list:
      "Olhei suas experiências (fonte: evidence_experience_list). O ponto mais fraco: conquistas sem métrica; qual resultado você consegue medir na sua última experiência?",
    research_save:
      "Registrei a fonte oficial do IBGE para o salário (fonte: ibge.gov.br). Confirma usar esse valor como referência?",
    ingest_text:
      "Criei uma ingestão com o seu texto; as propostas estão na revisão, nada foi gravado sem você aprovar.",
    ingest_file:
      "Criei uma ingestão com o arquivo anexado; as propostas vão para a revisão, nada foi gravado sem você aprovar.",
    ingest_github:
      "Preparei a análise do GitHub; confirme o orçamento na tela da execução para ela começar.",
    research_apply:
      "Gravei a faixa no seu perfil com a fonte pesquisada (fonte: research_save); o campo saiu da lista de pendências.",
    fact_gaps:
      "Vi o que ainda falta no seu perfil (fonte: fact_gaps). Primeira pergunta: na sua experiência mais recente, que resultado você consegue medir com um número?",
    fact_propose_change:
      "Preparei a alteração para você confirmar: o antes e o depois estão no cartão ao lado. Nada muda até você confirmar.",
    ingest_confirm: "Confirmei a estimativa; a ingestão começou e as propostas vão para a revisão.",
    ingest_propose:
      "Anotei a correção como proposta na revisão desta ingestão. Próxima pergunta: em que período isso aconteceu?",
    Agent:
      "Pedi ao recrutador especializado de cada perfil (fonte: recrutador-especializado): o perfil Eng. Software Sênior é o mais indicado, pelas experiências em backend. Quer que eu detalhe as lacunas?",
  };
  return byTool[tool] ?? `Usei ${tool}.`;
}

/** Menor valor que satisfaz um JSON Schema simples (só os campos obrigatórios; enum = 1º valor). */
export function minimalFromSchema(schema: Record<string, unknown>): unknown {
  const enumValues = schema.enum as unknown[] | undefined;
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  if ("const" in schema) return schema.const;
  const variants = (schema.anyOf ?? schema.oneOf) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(variants) && variants[0]) return minimalFromSchema(variants[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required ?? []) as string[];
      return Object.fromEntries(required.map((k) => [k, minimalFromSchema(props[k] ?? {})]));
    }
    case "array": {
      const min = typeof schema.minItems === "number" ? schema.minItems : 0;
      const items = (schema.items ?? {}) as Record<string, unknown>;
      return Array.from({ length: min }, () => minimalFromSchema(items));
    }
    case "string":
      return typeof schema.minLength === "number" && schema.minLength > 7
        ? "x".repeat(schema.minLength)
        : "exemplo";
    case "number":
    case "integer":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return null;
  }
}

/**
 * Roteiro do mock para os campos de remuneração: "R$ 12.500 por mês", "R$ 95 por hora", "30 horas semanais", "PJ"/"CLT".
 * Determinístico; o modelo real segue as regras do prompt de extração.
 */
export function mockCompensation(text: string): {
  fields: Record<string, unknown>;
  quote: string;
} | null {
  const money = /R\$\s*([\d.]+(?:,\d{1,2})?)\s*(?:por|\/|ao|a)\s*(hora|m[eê]s|ano)/i.exec(text);
  if (!money?.[1] || !money[2]) return null;
  const amount = Number(money[1].replace(/\./g, "").replace(",", "."));
  const unit = money[2].toLowerCase();
  const period = unit === "hora" ? "hourly" : unit === "ano" ? "yearly" : "monthly";
  const hours = /(\d{1,2})\s*(?:h|horas)\s*(?:semanais|por semana|\/semana)/i.exec(text);
  const contract = /\bPJ\b|contractor/i.test(text) ? "pj" : /\bCLT\b/.test(text) ? "clt" : null;
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .find((s) => s.includes(money[0]))
    ?.trim()
    .slice(0, 200);
  return {
    fields: {
      compensation: { amount, period, currency: "BRL" },
      ...(hours?.[1] ? { weeklyHours: Number(hours[1]) } : {}),
      ...(contract ? { employmentType: contract } : {}),
    },
    quote: sentence || money[0],
  };
}
