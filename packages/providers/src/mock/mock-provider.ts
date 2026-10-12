import { randomUUID } from "node:crypto";
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
import { type ChatEvent, type ChatHandle, type ChatOpenOptions, createAsyncQueue } from "../chat";
import {
  type AnalyzeProfilesProviderInput,
  type AnalyzeRepoInput,
  type AuthMethod,
  approxTokens,
  type BuildDigestInput,
  type CheckProposalsInput,
  type ExtractFactsInput,
  LOGIN_EXPIRED_HINT,
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
  | "checkProposals"
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
  authExpired: false,
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
    const turn = async (text: string) => {
      running = true;
      aborted = false;
      try {
        await this.gate("openChat");
        if (aborted) return interrupted("");
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
        const id = `mock-tool-${++rpcId}`;
        out.push({ type: "tool_start", id, name: tool, args: JSON.stringify(args).slice(0, 500) });
        const r = await callTool(tool, args);
        out.push({ type: "tool_end", id, isError: r.isError });
        if (aborted) return interrupted("");
        const reply = mockChatReply(tool, r.isError);
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
  opts: Pick<ChatOpenOptions, "category" | "ingestionRunId">,
): [string, Record<string, unknown>] {
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
  if (/^texto:|minha hist[oó]ria|ingira|ingest/i.test(text))
    return ["ingest_text", { text: text.replace(/^texto:\s*/i, "") }];
  return ["evidence_experience_list", {}];
}

/** Marcador do roteiro: troca pelo id da fonte mais recente antes de chamar `research_apply`. */
const LATEST_RESEARCH = "__fonte_mais_recente__";

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
    ingest_confirm: "Confirmei a estimativa; a ingestão começou e as propostas vão para a revisão.",
    ingest_propose:
      "Anotei a correção como proposta na revisão desta ingestão. Próxima pergunta: em que período isso aconteceu?",
  };
  return byTool[tool] ?? `Usei ${tool}.`;
}
