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
  // F04-fix-fundamentacao, R3: o que o juiz julgava "de olho" e dá para conferir sem modelo
  "searched_before_absence",
  "market_numbers_sourced",
  "no_save_promise",
  "max_reply_chars",
  "mentions",
] as const;

const GraderSchema = z.object({ type: z.enum(GRADER_TYPES), value: z.string().optional() });
export type Grader = z.infer<typeof GraderSchema>;

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["career", "ingest", "clarify", "discovery", "job"]).default("career"),
  /**
   * Como a conversa abre: padrão, uma sessão nova; `document_feedback`, pelo "Regerar com mensagem" do CV da vaga do
   * sandbox (a primeira mensagem é o feedback; a nota com o contexto vai junto); `application_chat`, pela conversa de
   * um formulário novo da vaga do sandbox (F12/M5, janela da extensão); `application_chat_no_posting`, o mesmo
   * formulário sem vaga ligada (F12-11).
   */
  open: z
    .enum([
      "document_feedback",
      "application_chat",
      "application_chat_no_posting",
      // F07/M6: "Conversar sobre esta candidatura" (a candidatura da vaga do sandbox)
      "job_application_chat",
    ])
    .optional(),
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
  /** Tools de cada resposta, em ordem (do recrutador e do subagente): a busca precisa estar no mesmo turno. */
  toolsByReply?: string[][];
}

/** Afirma que algo não está nos dados do usuário (A1). */
const ABSENCE =
  /(?<!\p{L})não\s+(?:está|aparece|consta|encontrei|achei|vi|há|tem|existe)(?!\p{L})[^.!?\n]{0,80}(?<!\p{L})(?:perfil|fatos|dados|histórico|currículo|cv)(?!\p{L})|(?<!\p{L})(?:perfil|fatos|histórico|currículo)\s+não\s+(?:tem|mostra|cita|traz|menciona|registra)(?!\p{L})/iu;
/** Valor em dinheiro: "R$ 14 mil", "US$ 6,000", "BRL 15.000", "14 a 20 mil reais". */
const MONEY =
  /(?:R\$|US\$|USD|BRL|EUR|€)\s*\d[\d.,]*(?:\s*(?:a|–|-)\s*\d[\d.,]*)?(?:\s*(?:mil|k))?|\d[\d.,]*\s*(?:mil|k)\s*(?:reais|dólares)/gi;
const digits = (s: string) => (s.match(/\d+/g) ?? []).map((d) => d.replace(/^0+/, ""));
/** Promessa de gravar direto (A5): a informação nova passa pela revisão do usuário. */
const SAVE_PROMISE =
  /(?<!\p{L})(?:eu\s+)?(?:registro|gravo|salvo|anoto|adiciono|atualizo|vou\s+(?:registrar|gravar|salvar|anotar|adicionar|atualizar|incluir))(?!\p{L})[^.!?\n]{0,60}(?<!\p{L})(?:fatos?|perfil|dados|histórico)(?!\p{L})/iu;

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
  // F07/M6: destino do link da agenda que a skill `candidaturas` entrega
  "google calendar",
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

/**
 * Calibração (2026-10-24, `test/evals/graders-calibration.test.ts`): o texto sem citações ("…", `…`) e sem títulos,
 * em frases. Uma interrogação dentro de uma citação ou num título não é pergunta à pessoa.
 */
const sentences = (text: string) =>
  text
    .replace(/^#{1,6} .*$/gm, "")
    .replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
// "fonte" afirmada, não negada ("sem fonte", "não tenho fonte", "nenhuma fonte")
const SOURCE_WORD =
  /(?<!\b(?:sem|nenhuma|tenho|há|achei)\s)\bfontes?\b(?=\s*:|\s+(?:d[aeo]s?|é|são|foi|foram|registrad))/i;
const SOURCE_DOMAIN = /\b[a-z0-9-]+\.(gov|org|com|fyi|io)(\.br)?\b/i;
// fato do registro da pessoa: experiência/conquista com nome ou id, ou o cartão, perfil ou registro dela
const SOURCE_RECORD =
  /\b(?:experiência|conquista|projeto|formação|skill)\s+(?:[a-z]\d+\b|(?:n[ao]|d[ao]|em)\s+[A-ZÀ-Ú])|\((?:experiência|conquista|projeto|skill)\s+[a-z]?\d+\)|\b(?:d[oa]|n[oa]|pel[oa])\s+seu\s+(?:cartão|perfil|registro|histórico)\b/i;
const ASK_IMPERATIVE =
  /\b(?:me\s+(?:conte|diga|fale|mande|passe|explique)|pode\s+me\s+(?:dizer|contar|passar|mandar))\b/i;
const CONFIRM_WORDS = /confirm|aprova|posso|quer que|pode ser|de acordo|devo|sigo com/i;

export function gradeTranscript(t: Transcript, graders: Grader[]): GradeResult[] {
  const all = t.replies.join("\n");
  return graders.map((g): GradeResult => {
    switch (g.type) {
      case "uses_tool": {
        // "a|b": qualquer uma das tools vale (ex.: cv_edit|cv_generate)
        const passed = (g.value ?? "").split("|").some((name) => t.tools.includes(name));
        return {
          type: g.type,
          passed,
          detail: passed
            ? `usou ${g.value}`
            : `não usou ${g.value}; usou: ${t.tools.join(", ") || "nenhuma"}`,
        };
      }
      case "cites_source": {
        const passed =
          /https?:\/\//.test(all) ||
          SOURCE_DOMAIN.test(all) ||
          SOURCE_WORD.test(all) ||
          SOURCE_RECORD.test(all);
        return { type: g.type, passed, detail: passed ? "cita fonte" : "nenhuma fonte citada" };
      }
      case "asks_question": {
        const passed = sentences(all).some((x) => x.endsWith("?") || ASK_IMPERATIVE.test(x));
        return {
          type: g.type,
          passed,
          detail: passed ? "faz pergunta" : "não pergunta nada ao usuário",
        };
      }
      case "asks_confirmation": {
        // a mesma frase pergunta e pede o aval (antes: um "?" e um "posso" em qualquer lugar do texto)
        const passed = sentences(all).some((x) => x.endsWith("?") && CONFIRM_WORDS.test(x));
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
      case "searched_before_absence": {
        const bad = t.replies.flatMap((r, i) =>
          ABSENCE.test(r) &&
          !(t.toolsByReply?.[i] ?? []).some((x) => x === "fact_search" || x === "fact_get")
            ? [i + 1]
            : [],
        );
        return {
          type: g.type,
          passed: bad.length === 0,
          detail: bad.length
            ? `afirma ausência sem buscar no mesmo turno (resposta ${bad.join(", ")})`
            : "nenhuma ausência afirmada sem busca",
        };
      }
      case "market_numbers_sourced": {
        const known = new Set(digits([t.card, ...(t.userText ?? [])].join(" ")));
        const unknown = [...all.matchAll(MONEY)]
          .map((m) => m[0])
          .filter((m) => digits(m).some((d) => !known.has(d)));
        // a pesquisa registrada na conversa (o registro da fonte pode ficar com a sessão do subagente)
        const researched = t.tools.includes("research_save");
        const passed = unknown.length === 0 || researched;
        return {
          type: g.type,
          passed,
          detail: passed
            ? unknown.length
              ? "valores com pesquisa registrada"
              : "sem valor de mercado novo"
            : `valor sem pesquisa registrada: ${unknown.slice(0, 3).join("; ")}`,
        };
      }
      case "no_save_promise": {
        const promise = sentences(all).find((x) => SAVE_PROMISE.test(x) && !/revis/i.test(x));
        return {
          type: g.type,
          passed: !promise,
          detail: promise
            ? `promete gravar sem a revisão: "${promise.slice(0, 120)}"`
            : "não promete gravar direto",
        };
      }
      case "max_reply_chars": {
        const max = Number(g.value ?? 1200);
        const long = t.replies.map((r, i) => [i + 1, r.length] as const).filter(([, n]) => n > max);
        return {
          type: g.type,
          passed: long.length === 0,
          detail: long.length
            ? `resposta acima de ${max} caracteres: ${long.map(([i, n]) => `${i} (${n})`).join(", ")}`
            : `todas até ${max} caracteres`,
        };
      }
      case "mentions": {
        const passed = new RegExp(g.value ?? "", "i").test(all);
        return {
          type: g.type,
          passed,
          detail: passed ? `menciona ${g.value}` : `não menciona ${g.value}`,
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
  // conquistas embaixo da experiência e skills com o nível: o juiz confere "liderou X na Acme" e "nível 3"
  // (calibração, 2026-10-24)
  return [
    ...f.experiences
      .list()
      .flatMap((e) => [
        `${e.company} · ${e.title} · ${span(e.startDate, e.endDate ?? "atual")}`,
        ...f.achievements
          .listByExperience(e.id)
          .map((a) => `  - ${a.text}${a.metric ? ` (${a.metric})` : ""}`),
      ]),
    ...f.education
      .list()
      .map((e) => `${e.institution} · ${e.course} · ${span(e.startDate, e.endDate)}`),
    ...f.projects
      .list()
      .map((p) =>
        [p.name, p.description, p.role && `papel: ${p.role}`, span(p.startDate, p.endDate)]
          .filter(Boolean)
          .join(" · "),
      ),
    ...f.languages.list().map((l) => (l.level ? `${l.name} (${l.level})` : l.name)),
    ...f.skills.list().map((s) => (s.level ? `${s.name} (nível ${s.level})` : s.name)),
  ].join("\n");
}
