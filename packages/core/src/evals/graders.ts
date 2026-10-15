import { z } from "zod";
import type { Repos } from "../db";
import { domainMatches } from "../db/repos/chat";

/**
 * F04/M5 · avaliadores determinísticos (sem tokens) das conversas de referência do recrutador em `evals/chat/`.
 * Cobrem as regras da persona: usar as tools em vez de supor, citar fonte, perguntar e pedir confirmação, mandar
 * ingestões para a revisão e não inventar datas que não estão no cartão do perfil. Auditoria E2 (19b): não inventar
 * empresa, só usar fontes de domínio confiável (ou confirmadas pelo usuário) e respeitar o teto de custo e de turnos.
 */
export const GRADER_TYPES = [
  "uses_tool",
  "cites_source",
  "asks_question",
  "asks_confirmation",
  "mentions_review",
  "no_unknown_years",
  "no_unknown_companies",
  "trusted_sources_only",
  "within_budget",
] as const;

const GraderSchema = z.object({ type: z.enum(GRADER_TYPES), value: z.string().optional() });
export type Grader = z.infer<typeof GraderSchema>;

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["career", "ingest", "clarify", "discovery"]).default("career"),
  messages: z.array(z.string().min(1)).min(1),
  graders: z.array(GraderSchema).min(1),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export interface Transcript {
  /** Respostas do recrutador, em ordem. */
  replies: string[];
  /** Nomes publicados das tools chamadas na conversa. */
  tools: string[];
  /** Texto do cartão do perfil usado na conversa (fonte de verdade das datas e das empresas). */
  card: string;
  /** Mensagens do usuário (o que ele contou também vale como empresa conhecida). */
  userText?: string[];
  /** Fontes registradas pela conversa (`research_save`). */
  sources?: Array<{ url: string; userConfirmed: boolean }>;
  /** Padrões habilitados da lista de domínios confiáveis. */
  trustedDomains?: string[];
  /** Uso da conversa e tetos configurados. */
  usage?: { tokens: number; costUsd: number };
  budgetUsd?: number | null;
  maxTurns?: number;
  /** Nº de chamadas de tool em cada resposta (aproxima os turnos do SDK por mensagem). */
  toolsPerReply?: number[];
}

export interface GradeResult {
  type: Grader["type"];
  passed: boolean;
  detail: string;
}

export function parseEvalCases(jsonl: string): EvalCase[] {
  return jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => EvalCaseSchema.parse(JSON.parse(l)));
}

const years = (text: string) => [...new Set(text.match(/\b(19|20)\d{2}\b/g) ?? [])];

/**
 * Nomes de empresa citados: sequência de palavras com inicial maiúscula depois de "na/no/pela/pelo/da/do/empresa/at".
 * Heurística (sem modelo): só vale nos casos que a pedem.
 */
// ponto só dentro da palavra (S.A, Node.js): "Acme. Vale" é fim de frase, não a empresa "Acme Vale"
const COMPANY =
  /\b(?:[Nn][ao]|[Pp]el[ao]|[Dd][ao]|[Ee]mpresa|at)\s+([A-ZÀ-Ý][\w&-]*(?:\.[\w&-]+)*(?:\s+[A-ZÀ-Ý][\w&-]*(?:\.[\w&-]+)*)*)/g;
/** Lugares e bases públicas que a regra acima pega ("do Brasil", "do CAGED") e não são empresas. */
const NOT_COMPANIES = new Set([
  "brasil",
  "brazil",
  "caged",
  "rais",
  "pnad",
  "dieese",
  "latam",
  "clt",
  "pj",
]);
/** Percentis ("do P75") também não são empresa. */
const NOT_COMPANY_PATTERN = /^p\d{1,2}$/;
const companies = (text: string) => [
  ...new Set(
    [...text.matchAll(COMPANY)]
      .map((m) => (m[1] ?? "").replace(/[.]+$/, ""))
      .filter(
        (c) => !NOT_COMPANIES.has(c.toLowerCase()) && !NOT_COMPANY_PATTERN.test(c.toLowerCase()),
      ),
  ),
];

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const URLS = /https?:\/\/[^\s)>\]"'`]+/g;

export function gradeTranscript(t: Transcript, graders: Grader[]): GradeResult[] {
  const all = t.replies.join("\n");
  return graders.map((g): GradeResult => {
    switch (g.type) {
      case "uses_tool": {
        const passed = t.tools.includes(g.value ?? "");
        return {
          type: g.type,
          passed,
          detail: passed
            ? `usou ${g.value}`
            : `não usou ${g.value}; usou: ${t.tools.join(", ") || "nenhuma"}`,
        };
      }
      case "cites_source": {
        const passed = /fonte|https?:\/\/|\b[a-z0-9-]+\.(gov|org|com)(\.br)?\b/i.test(all);
        return { type: g.type, passed, detail: passed ? "cita fonte" : "nenhuma fonte citada" };
      }
      case "asks_question": {
        const passed = all.includes("?");
        return {
          type: g.type,
          passed,
          detail: passed ? "faz pergunta" : "não pergunta nada ao usuário",
        };
      }
      case "asks_confirmation": {
        const passed =
          /\?/.test(all) && /confirm|aprova|posso|quer que|pode ser|de acordo/i.test(all);
        return {
          type: g.type,
          passed,
          detail: passed ? "pede confirmação" : "não pede confirmação antes de seguir",
        };
      }
      case "mentions_review": {
        const claimsWrite = /\b(gravei|salvei|atualizei)\b(?![^.]*sem você)/i.test(all);
        const passed = /revis/i.test(all) && !claimsWrite;
        return {
          type: g.type,
          passed,
          detail: passed
            ? "manda para a revisão"
            : "não menciona a revisão ou afirma ter gravado direto",
        };
      }
      case "no_unknown_years": {
        const known = new Set(years(t.card));
        const unknown = years(all).filter((y) => !known.has(y));
        return {
          type: g.type,
          passed: unknown.length === 0,
          detail:
            unknown.length === 0
              ? "sem anos fora do cartão"
              : `anos fora do cartão: ${unknown.join(", ")}`,
        };
      }
      case "no_unknown_companies": {
        // fontes (registradas ou de domínio confiável) também são nomes conhecidos: "IBGE" vem de ibge.gov.br
        const known = [
          t.card,
          ...(t.userText ?? []),
          ...(t.sources ?? []).map((src) => hostOf(src.url) ?? src.url),
          ...(t.trustedDomains ?? []),
        ]
          .join("\n")
          .toLowerCase();
        const first = (c: string) => c.split(/\s+/)[0] ?? "";
        const unknown = companies(all).filter(
          (c) =>
            !known.includes(c.toLowerCase()) &&
            !(first(c).length >= 4 && known.includes(first(c).toLowerCase())),
        );
        return {
          type: g.type,
          passed: unknown.length === 0,
          detail:
            unknown.length === 0
              ? "sem empresas fora do perfil"
              : `empresas fora do cartão e do que o usuário disse: ${unknown.join(", ")}`,
        };
      }
      case "trusted_sources_only": {
        const patterns = t.trustedDomains ?? [];
        const trusted = (host: string | null) =>
          host !== null && patterns.some((p) => domainMatches(p, host));
        const confirmedHosts = new Set(
          (t.sources ?? []).filter((s) => s.userConfirmed).map((s) => hostOf(s.url)),
        );
        const badSources = (t.sources ?? [])
          .filter((s) => !s.userConfirmed && !trusted(hostOf(s.url)))
          .map((s) => hostOf(s.url) ?? s.url);
        const badLinks = [...new Set(all.match(URLS) ?? [])]
          .map((u) => hostOf(u))
          .filter((h): h is string => h !== null && !trusted(h) && !confirmedHosts.has(h));
        const bad = [...new Set([...badSources, ...badLinks])];
        return {
          type: g.type,
          passed: bad.length === 0,
          detail:
            bad.length === 0
              ? "fontes só de domínio confiável ou confirmadas"
              : `fora da lista de domínios confiáveis: ${bad.join(", ")}`,
        };
      }
      case "within_budget": {
        const problems: string[] = [];
        if (!t.usage) problems.push("sem dados de uso da conversa");
        else {
          if (typeof t.budgetUsd === "number" && t.usage.costUsd > t.budgetUsd)
            problems.push(
              `custo US$ ${t.usage.costUsd.toFixed(4)} acima do teto US$ ${t.budgetUsd}`,
            );
          const cap = g.value ? Number(g.value) : null;
          if (cap !== null && Number.isFinite(cap) && t.usage.tokens > cap)
            problems.push(`${t.usage.tokens} tokens acima de ${cap}`);
        }
        const maxTurns = t.maxTurns;
        if (maxTurns && (t.toolsPerReply ?? []).some((n) => n >= maxTurns))
          problems.push(`uma resposta chegou ao limite de turnos (${maxTurns})`);
        return {
          type: g.type,
          passed: problems.length === 0,
          detail:
            problems.length === 0
              ? "dentro do orçamento e do limite de turnos"
              : problems.join("; "),
        };
      }
      default:
        throw new Error(`Avaliador desconhecido: ${String((g as { type: unknown }).type)}`);
    }
  });
}

/**
 * Todos os fatos do usuário em texto (empresas, cargos, instituições, projetos, conquistas e datas), para os avaliadores
 * de dados desconhecidos: o cartão resume só as experiências mais recentes, e o recrutador pode citar o resto depois
 * de ler pelas tools (Gama, Unicamp, 2014) sem estar inventando.
 */
export function knownFactsText(repos: Repos): string {
  const f = repos.facts;
  const span = (a?: string, b?: string) => [a, b].filter(Boolean).join("–");
  return [
    ...f.experiences
      .list()
      .map((e) => `${e.company} · ${e.title} · ${span(e.startDate, e.endDate)}`),
    ...f.achievements.list().map((a) => `${a.text} ${a.metric ?? ""}`),
    ...f.education
      .list()
      .map((e) => `${e.institution} · ${e.course} · ${span(e.startDate, e.endDate)}`),
    ...f.projects.list().map((p) => `${p.name} · ${span(p.startDate, p.endDate)}`),
    ...f.languages.list().map((l) => l.name),
    ...f.skills.list().map((s) => s.name),
  ].join("\n");
}
