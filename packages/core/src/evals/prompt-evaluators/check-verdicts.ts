import { type EvalParams, type EvalResult, jsonOf, listShort, result } from "./lib";

/**
 * Revisão anti-alucinação: um veredito por proposta enviada, nenhum a mais. Com referência
 * (`{ <proposalId>: status }`), o score é a fração de vereditos certos.
 */
export function checkVerdicts(p: EvalParams): EvalResult {
  let items: Array<{ proposalId?: string }> = [];
  try {
    items = JSON.parse(String(p.input?.items_json ?? "[]"));
  } catch {
    // entrada inválida: nada a cobrar
  }
  const expected = items.map((i) => String(i.proposalId));
  const results =
    (jsonOf(p.output) as { results?: Array<{ proposalId?: string; status?: string }> } | undefined)
      ?.results ?? [];
  const got = new Map(results.map((r) => [String(r.proposalId), String(r.status)]));
  const missing = expected.filter((id) => !got.has(id));
  const extra = [...got.keys()].filter((id) => !expected.includes(id));
  if (missing.length > 0 || extra.length > 0)
    return result(
      false,
      [
        missing.length ? `sem veredito: ${listShort(missing)}` : "",
        extra.length ? `ids que não foram enviados: ${listShort(extra)}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  const reference = p.reference as Record<string, string> | undefined;
  if (!reference || Object.keys(reference).length === 0)
    return result(true, `${expected.length} vereditos, um por proposta`);
  const wrong = Object.entries(reference).filter(([id, status]) => got.get(id) !== status);
  const score = (Object.keys(reference).length - wrong.length) / Object.keys(reference).length;
  return wrong.length === 0
    ? result(true, "todos os vereditos batem com a referência")
    : result(
        false,
        `vereditos diferentes da referência: ${listShort(wrong.map(([id, s]) => `${id} (esperado ${s}, veio ${got.get(id)})`))}`,
        score,
      );
}
