import {
  type EvalParams,
  type EvalResult,
  genderMarks,
  jsonOf,
  listShort,
  repeatsPhrase,
  result,
} from "./lib";

/**
 * Localizador do formulário (F12/M3): toda referência devolvida existe nos campos enviados, nenhum campo fica sem
 * destino (pergunta ou `ignored`) e nenhum aparece em duas perguntas. Nota pela fração de campos com destino.
 */
export function locateRefs(p: EvalParams): EvalResult {
  let sent: string[] = [];
  try {
    sent = (JSON.parse(String(p.input?.fields_json ?? "[]")) as Array<{ ref?: string }>).map((f) =>
      String(f.ref ?? ""),
    );
  } catch {
    sent = [];
  }
  const out = jsonOf(p.output) as
    | { questions?: Array<{ fieldRefs?: string[] }>; ignored?: string[] }
    | undefined;
  const used = (out?.questions ?? []).flatMap((q) => q.fieldRefs ?? []);
  const all = [...used, ...(out?.ignored ?? [])];
  const known = new Set(sent);
  const unknown = all.filter((r) => !known.has(r));
  const repeated = used.filter((r, i) => used.indexOf(r) !== i);
  const missing = sent.filter((r) => !all.includes(r));
  const problems: string[] = [];
  if (unknown.length) problems.push(`refs inventadas: ${listShort(unknown)}`);
  if (repeated.length) problems.push(`campo em duas perguntas: ${listShort(repeated)}`);
  if (missing.length) problems.push(`campos sem destino: ${listShort(missing)}`);
  const score = sent.length ? (sent.length - missing.length) / sent.length : 1;
  return problems.length === 0
    ? result(true, `${sent.length} campos, todos com destino`)
    : result(false, problems.join("; "), unknown.length || repeated.length ? 0 : score);
}

/**
 * Tipos esperados por campo (`reference.kinds`: ref → tipo): consentimento e autodeclaração nunca viram pergunta comum
 * (F12-12), e os rótulos quebrados entram juntos (`reference.together`: listas de refs na mesma pergunta).
 */
export function locateKinds(p: EvalParams): EvalResult {
  const ref = (p.reference ?? {}) as { kinds?: Record<string, string>; together?: string[][] };
  const out = jsonOf(p.output) as
    | { questions?: Array<{ fieldRefs?: string[]; kind?: string }>; ignored?: string[] }
    | undefined;
  const qs = out?.questions ?? [];
  const kindOf = (r: string) =>
    (out?.ignored ?? []).includes(r) ? "ignored" : qs.find((q) => q.fieldRefs?.includes(r))?.kind;
  const checks: string[] = [];
  let ok = 0;
  const kinds = Object.entries(ref.kinds ?? {});
  for (const [r, k] of kinds) {
    if (kindOf(r) === k) ok++;
    else checks.push(`${r}: ${kindOf(r) ?? "sem pergunta"} (esperado ${k})`);
  }
  const together = ref.together ?? [];
  for (const group of together) {
    const q = qs.find((x) => group.every((r) => x.fieldRefs?.includes(r)));
    if (q) ok++;
    else checks.push(`separados: ${group.join("+")}`);
  }
  const total = kinds.length + together.length;
  if (total === 0) return result(true, "sem tipos esperados no exemplo");
  return checks.length === 0
    ? result(true, `${total} conferências certas`)
    : result(false, checks.join("; "), ok / total);
}

/**
 * Respostas do formulário (F12/M4): uma por pergunta enviada, escolha só entre as opções, limite de caracteres e origens
 * que existem no resumo; com referência, as perguntas sem dado (`reference.gaps`) ficam como lacuna e as que têm dado
 * (`reference.answered`) recebem resposta. Nota pela fração de conferências certas.
 */
export function answerChecks(p: EvalParams): EvalResult {
  let questions: Array<{
    questionId: string;
    kind: string;
    options: string[];
    maxChars: number | null;
  }> = [];
  try {
    questions = JSON.parse(String(p.input?.questions_json ?? "[]"));
  } catch {
    questions = [];
  }
  const briefIds = new Set(
    [...String(p.input?.brief_json ?? "").matchAll(/"id":\s*"([^"]+)"/g)].map(
      (m) => m[1] as string,
    ),
  );
  const out = jsonOf(p.output) as
    | {
        answers?: Array<{
          questionId?: string;
          answer?: string | null;
          origins?: string[];
          gap?: string | null;
        }>;
      }
    | undefined;
  const answers = out?.answers ?? [];
  const ref = (p.reference ?? {}) as { gaps?: string[]; answered?: string[] };
  const problems: string[] = [];
  let ok = 0;
  let total = 0;
  const lower = (s: string) => s.trim().toLowerCase();
  for (const q of questions) {
    total++;
    const a = answers.find((x) => x.questionId === q.questionId);
    if (!a) {
      problems.push(`${q.questionId}: sem resposta nem lacuna`);
      continue;
    }
    const text = a.answer ?? "";
    if (text && q.options.length) {
      const parts = q.kind === "multi_choice" ? text.split(/\s*;\s*/) : [text];
      if (!parts.every((x) => q.options.some((o) => lower(o) === lower(x)))) {
        problems.push(`${q.questionId}: opção fora da lista ("${text}")`);
        continue;
      }
    }
    if (text && q.maxChars && text.length > q.maxChars) {
      problems.push(`${q.questionId}: ${text.length} caracteres (máximo ${q.maxChars})`);
      continue;
    }
    const unknown = (a.origins ?? []).filter((o) => !briefIds.has(o));
    if (unknown.length) {
      problems.push(`${q.questionId}: origens fora do resumo (${listShort(unknown)})`);
      continue;
    }
    ok++;
  }
  for (const id of ref.gaps ?? []) {
    total++;
    const a = answers.find((x) => x.questionId === id);
    if (a && !a.answer && a.gap) ok++;
    else problems.push(`${id}: devia ser lacuna (os dados não dizem)`);
  }
  for (const id of ref.answered ?? []) {
    total++;
    const a = answers.find((x) => x.questionId === id);
    if (a?.answer) ok++;
    else problems.push(`${id}: devia ter resposta (os dados dizem)`);
  }
  if (total === 0) return result(true, "sem perguntas no exemplo");
  return problems.length === 0
    ? result(true, `${total} conferências certas`)
    : result(false, problems.join("; "), ok / total);
}

const CLICHE =
  /(apaixonad[oa]|paix[aã]o por|passionate|desde (pequen|crian)|sempre sonhei|dream company|empresa dos sonhos)/i;

/**
 * Roleplay das perguntas abertas (F12-18): uma resposta por pergunta, no limite, ancorada em fatos do resumo (origens
 * que existem, pelo menos uma), sem clichê; com referência, as lacunas (`gaps`), as respondidas (`answered`), as que
 * precisam dizer o que supuseram (`assumes`), os termos que o texto cita (`mention`, por pergunta) e os que nunca
 * aparecem (`avoid`: fato inventado ou instrução da vaga seguida). Nota pela fração de conferências certas.
 */
export function roleplayChecks(p: EvalParams): EvalResult {
  let questions: Array<{ questionId: string; maxChars: number | null }> = [];
  try {
    questions = JSON.parse(String(p.input?.questions_json ?? "[]"));
  } catch {
    questions = [];
  }
  const briefIds = new Set(
    [...String(p.input?.brief_json ?? "").matchAll(/"id":\s*"([^"]+)"/g)].map(
      (m) => m[1] as string,
    ),
  );
  const out = jsonOf(p.output) as
    | {
        answers?: Array<{
          questionId?: string;
          answer?: string | null;
          assumptions?: string[];
          origins?: string[];
          gap?: string | null;
        }>;
      }
    | undefined;
  const answers = out?.answers ?? [];
  const ref = (p.reference ?? {}) as {
    gaps?: string[];
    answered?: string[];
    assumes?: string[];
    mention?: Record<string, string[]>;
    avoid?: string[];
  };
  const gaps = new Set(ref.gaps ?? []);
  const problems: string[] = [];
  let ok = 0;
  let total = 0;
  const check = (pass: boolean, problem: string) => {
    total++;
    if (pass) ok++;
    else problems.push(problem);
  };
  const lower = (s: string) => s.toLowerCase();
  for (const q of questions) {
    const a = answers.find((x) => x.questionId === q.questionId);
    const text = a?.answer ?? "";
    if (!a) {
      check(false, `${q.questionId}: sem resposta nem lacuna`);
      continue;
    }
    if (gaps.has(q.questionId)) {
      check(!text && Boolean(a.gap), `${q.questionId}: devia ser lacuna (sem âncora nos dados)`);
      continue;
    }
    check(Boolean(text), `${q.questionId}: devia ter o rascunho`);
    if (!text) continue;
    check(
      !q.maxChars || text.length <= q.maxChars,
      `${q.questionId}: ${text.length} caracteres (máximo ${q.maxChars})`,
    );
    const origins = a.origins ?? [];
    const unknown = origins.filter((o) => !briefIds.has(o));
    check(
      origins.length > 0 && unknown.length === 0,
      unknown.length
        ? `${q.questionId}: origens fora do resumo (${listShort(unknown)})`
        : `${q.questionId}: sem origem (o texto não se apoia em fatos)`,
    );
    check(!CLICHE.test(text), `${q.questionId}: clichê ("${text.match(CLICHE)?.[0]}")`);
  }
  for (const id of ref.answered ?? []) {
    const a = answers.find((x) => x.questionId === id);
    check(Boolean(a?.answer), `${id}: devia ter resposta`);
  }
  for (const id of ref.assumes ?? []) {
    const a = answers.find((x) => x.questionId === id);
    check(
      (a?.assumptions ?? []).some((x) => x.trim()),
      `${id}: a motivação não está nos dados e não foi dita como suposição`,
    );
  }
  for (const [id, terms] of Object.entries(ref.mention ?? {})) {
    const text = lower(answers.find((x) => x.questionId === id)?.answer ?? "");
    for (const term of terms) check(text.includes(lower(term)), `${id}: não cita "${term}"`);
  }
  // F12-23: com o tratamento do cadastro, as suposições seguem ele; motivação já aceita no perfil não é suposição
  let person: { address?: string; motivations?: string[] } = {};
  try {
    person = JSON.parse(String(p.input?.person_json ?? "{}"));
  } catch {
    person = {};
  }
  for (const a of answers)
    for (const s of a.assumptions ?? []) {
      if (person.address) {
        const marks = genderMarks(s, person.address);
        check(
          marks.length === 0,
          `${a.questionId}: suposição com gênero fora do tratamento ${person.address} (${marks.join(", ")})`,
        );
      }
      if (person.motivations?.length)
        check(
          !person.motivations.some((m) => repeatsPhrase(s, m)),
          `${a.questionId}: a suposição "${s}" já está nas motivações do perfil`,
        );
    }
  const all = lower(answers.map((a) => a.answer ?? "").join(" "));
  for (const term of ref.avoid ?? [])
    check(!all.includes(lower(term)), `cita "${term}" (não está nos dados)`);
  if (total === 0) return result(true, "sem perguntas no exemplo");
  return problems.length === 0
    ? result(true, `${total} conferências certas`)
    : result(false, problems.join("; "), ok / total);
}
