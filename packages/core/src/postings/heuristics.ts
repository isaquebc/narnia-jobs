import type {
  PostingFields,
  PostingRole,
  PostingSeniority,
  PostingWorkMode,
} from "@narnia-jobs/shared";
import { DICTIONARY, dictionaryIndex, normalizeTerm, type TermCategory } from "./dictionary";

/**
 * Heurística local da vaga, sem tokens (F06-1, §2.3): dicionário + n-gramas, seções (obrigatórios × diferenciais),
 * cargo, senioridade, role, contrato, modo de trabalho, local, moeda, faixa e benefícios. O resultado é a pré-análise
 * que aparece antes do modelo e que o agente de merge compara com a extração do modelo (F06-6).
 */
export type KeywordSection = "required" | "nice" | "other";

export interface HeuristicKeyword {
  term: string;
  category: TermCategory;
  section: KeywordSection;
  count: number;
}

export interface PostingHeuristics {
  keywords: HeuristicKeyword[];
  /** Termos com cara de tecnologia que não estão no dicionário (para revisão e para ampliar o dicionário). */
  ngrams: string[];
  /** A vaga tinha cabeçalhos de seção; sem eles, todo termo conta como obrigatório. */
  sectionsDetected: boolean;
  yearsMin: number | null;
  /** Campos que a heurística conseguiu preencher (só os encontrados). */
  fields: Partial<PostingFields>;
}

type Section = "required" | "nice" | "responsibilities" | "benefits" | "about" | "none";

const HEADERS: Array<[Exclude<Section, "none">, RegExp]> = [
  [
    "responsibilities",
    /^(responsabilidades|atribuicoes|atividades|principais (atividades|responsabilidades)|o que voce (vai|ira) fazer|what you('ll| will)? do|responsibilities|your responsibilities|key responsibilities|(no )?dia a dia|the role|sobre a vaga|about the role|desafios)$/,
  ],
  [
    "nice",
    /^(diferenciais?|desejavel|desejaveis|requisitos desejaveis|nice to have|nice-to-have|bonus( points)?|plus|seria (legal|otimo|um diferencial)|pontos extras|preferred qualifications|it'?s a plus|good to have)$/,
  ],
  [
    "required",
    /^(requisitos( obrigatorios| tecnicos)?|requirements|qualificacoes|qualifications|o que (voce precisa( ter)?|esperamos( de voce)?|buscamos)|o que e necessario|must have|must-have|what you('ll| will)? need|what we('re| are)? looking for|you have|sobre voce|about you|hard skills|competencias( tecnicas)?|conhecimentos( necessarios| obrigatorios| tecnicos)?|pre-?requisitos|minimum qualifications|basic qualifications)$/,
  ],
  [
    "benefits",
    /^(beneficios|benefits|o que oferecemos|what we offer|we offer|perks|perks and benefits|perks & benefits|vantagens)$/,
  ],
  ["about", /^(sobre (a empresa|nos|a [\p{L}]+)|about (us|the company)|quem somos)$/u],
];

const BULLET = /^\s*(?:[-*•·–]|\d+[.)])\s+/;

const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function headerOf(line: string): { section: Exclude<Section, "none">; rest: string } | null {
  const clean = line.replace(/^[#*\s]+/, "").replace(/[*\s]+$/, "");
  const inline = /^([^:]{2,45}):\s*(.*)$/.exec(clean);
  const head = strip((inline?.[1] ?? clean).replace(/:$/, "")).trim();
  if (head.length > 50) return null;
  for (const [section, re] of HEADERS)
    if (re.test(head)) return { section, rest: inline ? (inline[2] ?? "").trim() : "" };
  return null;
}

interface Line {
  text: string;
  section: Section;
}

function splitSections(text: string): { lines: Line[]; detected: boolean } {
  const out: Line[] = [];
  let section: Section = "none";
  let items = 0;
  let detected = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      // seção com itens termina na linha em branco (o texto solto depois não é item dela)
      if (items > 0) {
        section = "none";
        items = 0;
      }
      continue;
    }
    const h = headerOf(line);
    if (h) {
      section = h.section;
      items = 0;
      if (h.section !== "about") detected = true;
      if (h.rest) {
        out.push({ text: h.rest, section });
        items++;
      }
      continue;
    }
    out.push({ text: line, section });
    if (section !== "none") items++;
  }
  return { lines: out, detected };
}

const ITEM = (s: string) => s.replace(BULLET, "").trim();

/* ---------- termos ---------- */

const EXACT = DICTIONARY.flatMap((term) =>
  (term.caseSensitive ?? []).map((spelling) => ({
    term,
    re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(spelling)}(?![\\p{L}\\p{N}$+#])`, "u"),
  })),
);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termsIn(line: string): Array<{ canonical: string; category: TermCategory }> {
  const index = dictionaryIndex();
  const tokens = normalizeTerm(line)
    .split(" ")
    .map((t) => (t === ".net" ? t : t.replace(/^[./]+|[./]+$/g, "")))
    .filter(Boolean);
  const found: Array<{ canonical: string; category: TermCategory }> = [];
  for (let i = 0; i < tokens.length; ) {
    let hit = 0;
    for (let n = Math.min(4, tokens.length - i); n >= 1; n--) {
      const term = index.get(tokens.slice(i, i + n).join(" "));
      if (term) {
        found.push({ canonical: term.canonical, category: term.category });
        hit = n;
        break;
      }
    }
    i += hit || 1;
  }
  for (const { term, re } of EXACT)
    if (re.test(line)) found.push({ canonical: term.canonical, category: term.category });
  return found;
}

const SECTION_RANK: Record<KeywordSection, number> = { required: 3, nice: 2, other: 1 };

function keywordsOf(lines: Line[], detected: boolean): HeuristicKeyword[] {
  const map = new Map<string, HeuristicKeyword>();
  for (const l of lines) {
    const section: KeywordSection = !detected
      ? "required"
      : l.section === "required"
        ? "required"
        : l.section === "nice"
          ? "nice"
          : "other";
    for (const t of termsIn(l.text)) {
      const cur = map.get(t.canonical);
      if (!cur)
        map.set(t.canonical, { term: t.canonical, category: t.category, section, count: 1 });
      else {
        cur.count++;
        if (SECTION_RANK[section] > SECTION_RANK[cur.section]) cur.section = section;
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => SECTION_RANK[b.section] - SECTION_RANK[a.section] || b.count - a.count,
  );
}

/** Tokens com cara de tecnologia (CamelCase, dígito no meio, `.io`, `+`, `#`) fora do dicionário, por frequência. */
function ngramsOf(text: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.split(/[\s,;:()[\]{}"'“”]+/)) {
    const tok = raw.replace(/[.!?]+$/, "");
    if (tok.length < 3 || /^\d/.test(tok) || /^[\p{Lu}\d]+$/u.test(tok)) continue;
    if (!/\p{Ll}\p{Lu}|\p{L}\d|\.\p{L}{2,}|[+#]/u.test(tok)) continue;
    if (termsIn(tok).length > 0) continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);
}

/* ---------- campos ---------- */

const SENIORITY: Array<[PostingSeniority, RegExp]> = [
  ["intern", /\b(estagi\w*|intern(ship)?)\b/],
  ["junior", /\b(junior|jr)\b/],
  ["pleno", /\b(pleno|mid[- ]?level|mid)\b/],
  ["senior", /\b(senior|sr)\b/],
  ["staff", /\b(staff|principal)\b/],
  ["lead", /\b(tech lead|technical lead|lead|lider tecnic\w*)\b/],
  ["manager", /\b(manager|gerente|head of|coordenador\w*)\b/],
  ["director", /\b(diretor\w*|director|vp)\b/],
];

function seniorityIn(text: string): PostingSeniority | null {
  const t = strip(text);
  let best: PostingSeniority | null = null;
  SENIORITY.forEach(([level, re], i) => {
    if (re.test(t) && (best === null || i > SENIORITY.findIndex(([l]) => l === best))) best = level;
  });
  return best;
}

const ROLES: Array<[PostingRole, RegExp]> = [
  [
    "engineering_manager",
    /engineering manager|gerente de engenharia|head of engineering|gestor\w* de engenharia/,
  ],
  ["tech_lead", /tech(nical)? lead|lider tecnic/],
  ["architect", /arquitet|architect/],
  ["data_science", /cientista de dados|data scien/],
  [
    "ml_engineering",
    /machine learning engineer|\bml engineer|engenheir\w* de (machine learning|ml)\b/,
  ],
  ["data_engineering", /engenheir\w* de dados|data engineer/],
  ["devops_sre", /devops|\bsre\b|site reliability/],
  ["platform", /platform engineer|engenheir\w* de plataforma/],
  ["security", /security engineer|engenheir\w* de seguranca|appsec|seguranca da informacao/],
  ["qa", /\bqa\b|quality assurance|analista de testes|test engineer/],
  ["mobile", /\bmobile\b|\bandroid\b|\bios\b|\bflutter\b|react native/],
  ["fullstack", /full[- ]?stack/],
  ["frontend", /front[- ]?end/],
  ["backend", /back[- ]?end/],
  ["embedded", /embarcad|embedded/],
  ["product_management", /product manager|gerente de produto|product owner/],
  ["product_design", /product designer|ux designer|ui designer|designer de produto/],
  ["support", /\bsuporte\b|support engineer/],
];

function roleIn(text: string): PostingRole | null {
  const t = strip(text);
  for (const [role, re] of ROLES) if (re.test(t)) return role;
  return null;
}

const TITLE_HINT =
  /desenvolvedor|developer|engineer|engenheir|programador|analista|analyst|manager|gerente|cientista|scientist|designer|lead|lider|arquitet|architect|devops|sre|especialista|specialist|coordenador|head|estagi|intern/;

function titleOf(lines: Line[]): string | null {
  const first = lines[0]?.text ?? "";
  if (!first || first.length > 90 || /[.:]$/.test(first) || !TITLE_HINT.test(strip(first)))
    return null;
  return first.replace(BULLET, "").trim();
}

function firstOf<T>(t: string, table: Array<[T, RegExp]>): T | null {
  let best: { v: T; at: number } | null = null;
  for (const [v, re] of table) {
    const m = re.exec(t);
    if (m && (best === null || m.index < best.at)) best = { v, at: m.index };
  }
  return best?.v ?? null;
}

type ContractType = NonNullable<PostingFields["contractType"]>;

const CONTRACT: Array<[ContractType, RegExp]> = [
  ["clt", /\bclt\b/],
  ["pj", /\bpj\b|pessoa juridica|\bcontractor\b/],
  ["freelance", /freela\w*|freelance\w*/],
  ["internship", /\bestagio\b|\binternship\b/],
  ["temporary", /temporari\w*|\btemporary\b/],
];

function workModeIn(t: string): PostingWorkMode | null {
  if (/hibrid|hybrid/.test(t)) return "hybrid";
  return firstOf<PostingWorkMode>(t, [
    ["onsite", /presencial|on-site|\bonsite\b|in[- ]office/],
    ["remote", /remot|home office|anywhere/],
  ]);
}

const UF = "AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO";
const CITY_UF = new RegExp(
  `(\\p{Lu}[\\p{L}]+(?: (?:de|do|da|dos|das|\\p{Lu}[\\p{L}]+))*)\\s*(?:-|–|/|,|\\()\\s*(${UF})\\b`,
  "u",
);

const CURRENCY: Array<[string, RegExp]> = [
  ["BRL", /R\$|\bBRL\b/],
  ["USD", /US\$|\bUSD\b|(?<![A-Z])\$/],
  ["EUR", /€|\bEUR\b/],
  ["GBP", /£|\bGBP\b/],
];
const CUR = "R\\$|US\\$|USD|BRL|€|EUR|£|GBP|\\$";
const SALARY = new RegExp(
  `(${CUR})\\s*([\\d.,]+)\\s*(k|mil)?\\s*(?:-|–|a|até|to)\\s*(?:${CUR})?\\s*([\\d.,]+)\\s*(k|mil)?`,
  "i",
);

function parseAmount(raw: string, suffix: string | undefined): number {
  const n = Number(raw.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."));
  return suffix ? n * 1000 : n;
}

function currencyOf(symbol: string): string | null {
  for (const [code, re] of CURRENCY) if (re.test(symbol)) return code;
  return null;
}

function periodAfter(text: string): PostingFields["salaryPeriod"] {
  const t = strip(text.slice(0, 40));
  if (/\bmes\b|mensal|month|\/m\b|\bmo\b/.test(t)) return "monthly";
  if (/\bano\b|anual|year|annual|\/y/.test(t)) return "yearly";
  if (/\bhora\b|hour|\/h\b/.test(t)) return "hourly";
  return null;
}

const KNOWN_BENEFITS: Array<[string, RegExp]> = [
  ["Vale refeição", /vale refeicao|\bvr\b/],
  ["Vale alimentação", /vale alimentacao|\bva\b/],
  ["Plano de saúde", /plano de saude|assistencia medica|health insurance/],
  ["Plano odontológico", /odontologic|dental/],
  ["Seguro de vida", /seguro de vida|life insurance/],
  ["Gympass", /gympass|wellhub|totalpass/],
  ["PLR", /\bplr\b|participacao nos lucros|profit sharing/],
  ["Auxílio home office", /auxilio home office|home office allowance/],
  ["Stock options", /stock options|\besop\b/],
  ["Auxílio educação", /auxilio educacao|education allowance|learning budget/],
  ["Previdência privada", /previdencia privada|401k|pension/],
];

export function analyzePostingText(text: string): PostingHeuristics {
  const { lines, detected } = splitSections(text);
  const t = strip(text);
  const items = (section: Section) =>
    lines.filter((l) => l.section === section).map((l) => ITEM(l.text));
  const fields: Partial<PostingFields> = {};
  const title = titleOf(lines);
  if (title) fields.title = title;
  const seniority = (title && seniorityIn(title)) || seniorityIn(text);
  if (seniority) fields.seniority = seniority;
  const role = (title && roleIn(title)) || roleIn(text);
  if (role) fields.role = role;
  const contract = firstOf(t, CONTRACT);
  if (contract) fields.contractType = contract;
  const mode = workModeIn(t);
  if (mode) fields.workMode = mode;
  const place = CITY_UF.exec(text);
  if (place) {
    fields.city = place[1] as string;
    fields.state = place[2] as string;
    fields.country = "BR";
  }
  const client = /\b(?:cliente|client)\s*:\s*([^·\n|]+)/i.exec(text)?.[1]?.trim();
  if (client) fields.client = client;
  const company = /\b(?:empresa|company)\s*:\s*([^·\n|]+)/i.exec(text)?.[1]?.trim();
  if (company) fields.company = company;
  const salary = SALARY.exec(text);
  if (salary) {
    fields.currency = currencyOf(salary[1] as string);
    fields.salaryMin = parseAmount(salary[2] as string, salary[3]);
    fields.salaryMax = parseAmount(salary[4] as string, salary[5] ?? salary[3]);
    const period = periodAfter(text.slice((salary.index ?? 0) + salary[0].length));
    if (period) fields.salaryPeriod = period;
  } else {
    const cur = firstOf(text, CURRENCY);
    if (cur) fields.currency = cur;
  }
  const required = items("required");
  const nice = items("nice");
  const resp = items("responsibilities");
  const benefits = items("benefits");
  const about = items("about");
  if (required.length) fields.skillsRequired = required;
  if (nice.length) fields.skillsNice = nice;
  if (resp.length) fields.responsibilities = resp;
  if (benefits.length) fields.benefits = benefits;
  else {
    const known = KNOWN_BENEFITS.filter(([, re]) => re.test(t)).map(([label]) => label);
    if (known.length) fields.benefits = known;
  }
  if (about.length) fields.companySummary = about.slice(0, 3).join(" ");
  const years = [...t.matchAll(/(\d{1,2})\s*\+?\s*(?:anos|years|yrs)/g)].map((m) => Number(m[1]));
  return {
    keywords: keywordsOf(lines, detected),
    ngrams: ngramsOf(text),
    sectionsDetected: detected,
    yearsMin: years.length ? Math.max(...years) : null,
    fields,
  };
}
