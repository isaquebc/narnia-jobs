import { type EvalParams, type EvalResult, jsonOf, listShort, result } from "./lib";

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
