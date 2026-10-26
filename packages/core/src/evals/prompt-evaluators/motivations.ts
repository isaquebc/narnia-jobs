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
 * Motivações do perfil (F12-23): no máximo `quantas` frases (com `min` na referência, ao menos isso), até 120
 * caracteres, cada uma com origem que existe no resumo, sem repetir as aceitas nem as recusadas, sem marca de gênero
 * contrária ao tratamento e sem os termos de `avoid`. Nota pela fração de conferências certas.
 */
export function motivationChecks(p: EvalParams): EvalResult {
  const parse = (v: unknown): string[] => {
    try {
      const x = JSON.parse(String(v ?? "[]"));
      return Array.isArray(x) ? x.map(String) : [];
    } catch {
      return [];
    }
  };
  const briefIds = new Set(
    [...String(p.input?.brief_json ?? "").matchAll(/"id":\s*"([^"]+)"/g)].map(
      (m) => m[1] as string,
    ),
  );
  const count = Number(p.input?.count ?? 0);
  const address = String(p.input?.address ?? "neutro");
  const known = [...parse(p.input?.accepted_json), ...parse(p.input?.refused_json)];
  const ref = (p.reference ?? {}) as { min?: number; avoid?: string[] };
  const out = jsonOf(p.output) as
    | { motivations?: Array<{ text?: string; origins?: string[] }> }
    | undefined;
  const items = out?.motivations ?? [];
  const problems: string[] = [];
  let ok = 0;
  let total = 0;
  const check = (pass: boolean, problem: string) => {
    total++;
    if (pass) ok++;
    else problems.push(problem);
  };
  if (count > 0) check(items.length <= count, `${items.length} frases (máximo ${count})`);
  if (ref.min !== undefined)
    check(items.length >= ref.min, `${items.length} frases (mínimo ${ref.min})`);
  items.forEach((m, i) => {
    const text = String(m.text ?? "").trim();
    const n = `frase ${i + 1}`;
    check(text.length > 0 && text.length <= 120, `${n}: ${text.length} caracteres (máximo 120)`);
    const origins = m.origins ?? [];
    const unknown = origins.filter((o) => !briefIds.has(o));
    check(
      origins.length > 0 && unknown.length === 0,
      unknown.length ? `${n}: origens fora do resumo (${listShort(unknown)})` : `${n}: sem origem`,
    );
    check(
      !known.some((k) => repeatsPhrase(text, k)),
      `${n}: repete uma aceita ou recusada ("${text}")`,
    );
    const marks = genderMarks(text, address);
    check(marks.length === 0, `${n}: gênero fora do tratamento ${address} (${marks.join(", ")})`);
    for (const term of ref.avoid ?? [])
      check(!text.toLowerCase().includes(term.toLowerCase()), `${n}: cita "${term}"`);
  });
  if (total === 0) return result(true, "sem frases nem limites no exemplo");
  return problems.length === 0
    ? result(true, `${total} conferências certas`)
    : result(false, problems.join("; "), ok / total);
}
