import type {
  ApplicationLocateOutput,
  ApplicationQuestion,
  ApplicationQuestionKind,
  FormField,
  ProfileField,
  SelfDeclarationTopic,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { formatPhone } from "../phone";

/**
 * Localizar as perguntas do formulário (F12/M3, §4.6-1). A heurística vem antes e não gasta tokens: campos óbvios
 * (nome, e-mail, telefone, links, cidade) saem dos dados da pessoa; consentimento (LGPD, termos) e autodeclaração
 * (raça, gênero, deficiência…) são marcados por código e nunca recebem resposta sugerida (F12-12). O resto vai para
 * o Haiku (`narnia-application-locate`), e `assembleQuestions` confere o que ele devolveu: só campos que existem,
 * opções tiradas dos campos (nunca do modelo) e nenhum campo esquecido.
 */

/** Tarefa do formulário na fila `extract` (F12/M3). */
export const APPLICATION_TASKS = { locate: "application.locate" } as const;

/** Menos campos que isso não é formulário de candidatura (busca, newsletter, login). */
export const MIN_APPLICATION_FIELDS = 2;

export interface FieldClass {
  profileField: ProfileField | null;
  consent: boolean;
  topic: SelfDeclarationTopic | null;
}

const TEXTISH = new Set(["text", "email", "tel", "url"]);

const AUTOCOMPLETE: Record<string, ProfileField> = {
  name: "full_name",
  "given-name": "first_name",
  "family-name": "last_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "address-level2": "city",
};

/** Em ordem: o primeiro que casa decide (sobrenome antes de nome, etc.). */
const PROFILE_PATTERNS: Array<[ProfileField, RegExp]> = [
  ["linkedin", /linkedin/i],
  ["github", /github/i],
  ["portfolio", /(portf[oó]lio|website|site pessoal|personal (site|website)|\bblog\b)/i],
  ["email", /(e-?mail)/i],
  ["phone", /(telefone|celular|whats ?app|phone|mobile|\btel\b)/i],
  ["last_name", /(sobrenome|last ?name|surname|family name)/i],
  ["first_name", /(primeiro nome|first ?name|given name|^nome\s*\*?$)/i],
  ["full_name", /(nome completo|full ?name|^name\s*\*?$|^seu nome|^your name)/i],
  ["city", /^(cidade|city)\b/i],
];

/** Parecido com nome, mas não é o da pessoa (empresa, referência, nome social é autodeclaração). */
const NOT_PROFILE =
  /(empresa|company|refer[eê]ncia|reference|m[aã]e|pai|social|projeto|project|escola|school)/i;

const CONSENT =
  /(lgpd|pol[ií]tica de privacidade|privacy|termos|terms|consent|autorizo|concordo|i agree|aceito|li e aceito|declaro que|i certify|i acknowledge)/i;

const TOPICS: Array<[SelfDeclarationTopic, RegExp]> = [
  ["sexual_orientation", /(orienta[cç][aã]o sexual|sexual orientation|lgbt)/i],
  ["race", /(ra[cç]a|\bcor\b|etnia|[eé]tnico|race|ethnic)/i],
  ["gender", /(g[eê]nero|\bsexo\b|gender|nome social|identidade de g|pronom|pronoun)/i],
  ["disability", /(defici[eê]n|\bpcd\b|disabilit|neurodiverg)/i],
  ["religion", /(religi)/i],
  ["age", /(\bidade\b|data de nascimento|nascimento|date of birth|birth ?date|\bage\b)/i],
  ["veteran", /(veteran|militar)/i],
  // pertencer a um grupo (o gate do localizador mostrou que o Haiku às vezes trata como sim ou não)
  [
    "other",
    /(sub-?representad|under-?represented|minoria|minorit|grupo de diversidade|diversity group)/i,
  ],
];

const textOf = (f: FormField) => [f.label, f.name, f.placeholder].filter(Boolean).join(" ");

export function classifyField(f: FormField): FieldClass {
  const text = textOf(f);
  const label = f.label ?? f.placeholder ?? f.name ?? "";
  const topic = TOPICS.find(([, re]) => re.test(text))?.[0] ?? null;
  const consent =
    !topic && (f.control === "checkbox" || f.control === "checkboxes") && CONSENT.test(text);
  let profileField: ProfileField | null = null;
  if (!topic && !consent && TEXTISH.has(f.control)) {
    const ac = (f.autocomplete ?? "").split(/\s+/).pop() ?? "";
    profileField =
      AUTOCOMPLETE[ac] ??
      (f.control === "email" ? "email" : f.control === "tel" ? "phone" : null) ??
      (NOT_PROFILE.test(label)
        ? null
        : (PROFILE_PATTERNS.find(([, re]) => re.test(label.trim()))?.[0] ?? null));
  }
  return { profileField, consent, topic };
}

/** Tipo de pergunta pelo tipo de campo, quando o modelo não organizou (ou não precisou). */
export function controlKind(control: FormField["control"]): ApplicationQuestionKind {
  switch (control) {
    case "textarea":
    case "richtext":
      return "long_text";
    case "select":
    case "radio":
    case "combobox":
      return "choice";
    case "multiselect":
    case "checkboxes":
      return "multi_choice";
    case "checkbox":
      return "yes_no";
    case "number":
      return "number";
    case "date":
      return "date";
    case "file":
      return "file";
    default:
      return "short_text";
  }
}

const questionText = (f: FormField) =>
  (f.label ?? f.placeholder ?? f.name ?? "Campo sem rótulo").replace(/\s*\*\s*$/, "").trim() ||
  "Campo sem rótulo";

type Draft = Omit<ApplicationQuestion, "id">;

function fromField(f: FormField, over: Partial<Draft> = {}): Draft {
  return {
    question: questionText(f),
    kind: controlKind(f.control),
    options: f.options,
    required: f.required,
    maxChars: f.maxLength,
    fieldRefs: [f.ref],
    section: f.section,
    profileField: null,
    topic: null,
    source: "heuristic",
    ...over,
  };
}

/** O que a heurística resolve sem modelo e os campos que sobram para ele. */
export function heuristicQuestions(fields: FormField[]): { questions: Draft[]; rest: FormField[] } {
  const questions: Draft[] = [];
  const rest: FormField[] = [];
  for (const f of fields) {
    const c = classifyField(f);
    if (c.profileField)
      questions.push(fromField(f, { kind: "short_text", profileField: c.profileField }));
    else if (c.consent) questions.push(fromField(f, { kind: "consent" }));
    else if (c.topic) questions.push(fromField(f, { kind: "self_declaration", topic: c.topic }));
    else rest.push(f);
  }
  return { questions, rest };
}

const CHOICE_KINDS = new Set<ApplicationQuestionKind>(["choice", "multi_choice", "yes_no"]);

/**
 * Perguntas finais na ordem da página: as da heurística, as do modelo conferidas (referências que existem e ninguém
 * tomou; opções e limite dos próprios campos) e, para cada campo que sobrou sem pergunta e não foi descartado pelo
 * modelo, uma pergunta pelo rótulo. Sem o modelo (`null`), todo campo restante vira pergunta pelo rótulo.
 */
export function assembleQuestions(
  fields: FormField[],
  heuristic: { questions: Draft[] },
  model: ApplicationLocateOutput | null,
): ApplicationQuestion[] {
  const byRef = new Map(fields.map((f, i) => [f.ref, { f, i }]));
  const claimed = new Set(heuristic.questions.flatMap((q) => q.fieldRefs));
  const drafts: Draft[] = [...heuristic.questions];
  for (const q of model?.questions ?? []) {
    const refs = [...new Set(q.fieldRefs)].filter((r) => byRef.has(r) && !claimed.has(r));
    if (!refs.length) continue;
    for (const r of refs) claimed.add(r);
    const own = refs.map((r) => byRef.get(r)?.f as FormField);
    const options = own.flatMap((f) => f.options);
    const limits = own.map((f) => f.maxLength).filter((n): n is number => n !== null);
    // tipo de escolha sem opções nos campos (combobox fechado) fica como escolha; texto com opções vira escolha
    const kind: ApplicationQuestionKind =
      !CHOICE_KINDS.has(q.kind) &&
      options.length > 0 &&
      q.kind !== "self_declaration" &&
      q.kind !== "consent"
        ? "choice"
        : q.kind;
    drafts.push({
      question: q.question.trim(),
      kind,
      options,
      required: q.required || own.some((f) => f.required),
      maxChars: limits.length ? Math.min(...limits) : null,
      fieldRefs: refs,
      section: q.section ?? own[0]?.section ?? null,
      profileField: null,
      topic: kind === "self_declaration" ? (q.topic ?? "other") : null,
      source: "model",
    });
  }
  const ignored = new Set(model?.ignored ?? []);
  for (const f of fields) if (!claimed.has(f.ref) && !ignored.has(f.ref)) drafts.push(fromField(f));
  const first = (d: Draft) => Math.min(...d.fieldRefs.map((r) => byRef.get(r)?.i ?? 0));
  return drafts.sort((a, b) => first(a) - first(b)).map((d, i) => ({ id: `q${i + 1}`, ...d }));
}

/** Valor de um campo óbvio a partir dos dados da pessoa (null quando ela não tem o dado). */
export function prefillValue(repos: Repos, field: ProfileField): string | null {
  const user = repos.users.get();
  if (!user) return null;
  const full = user.fullName ?? user.displayName ?? null;
  const parts = full?.trim().split(/\s+/) ?? [];
  const link = (re: RegExp) =>
    user.links?.find((l) => re.test(l.url) || re.test(l.label))?.url ?? null;
  switch (field) {
    case "full_name":
      return full;
    case "first_name":
      return parts[0] ?? null;
    case "last_name":
      return parts.length > 1 ? parts.slice(1).join(" ") : null;
    case "email":
      return user.email ?? null;
    case "phone":
      return user.phone?.e164 ? formatPhone(user.phone.e164, "en-US") : null;
    case "linkedin":
      return link(/linkedin\.com/i);
    case "github":
      return link(/github\.com/i);
    case "portfolio":
      return link(/^(?!.*(linkedin|github)\.com).*(portf|site|blog|http)/i);
    case "city":
      return user.city ?? null;
  }
}
