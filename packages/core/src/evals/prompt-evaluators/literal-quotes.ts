import {
  collectByKey,
  type EvalParams,
  type EvalResult,
  jsonOf,
  listShort,
  normalizeText,
  result,
  sourceText,
} from "./lib";

/** Anti-alucinação: todo `evidence.quote` (ou `quote`) da saída aparece literalmente na fonte do exemplo. */
export function literalQuotes(p: EvalParams, config: { sourceFields: string[] }): EvalResult {
  const source = normalizeText(sourceText(p.input, config.sourceFields));
  const quotes = collectByKey(jsonOf(p.output), "quote").filter(
    (q): q is string => typeof q === "string" && q.trim().length > 0,
  );
  if (quotes.length === 0) return result(true, "nenhuma citação na resposta");
  const missing = quotes.filter((q) => !source.includes(normalizeText(q)));
  const score = (quotes.length - missing.length) / quotes.length;
  return missing.length === 0
    ? result(true, `${quotes.length} citações, todas na fonte`)
    : result(
        false,
        `${missing.length} de ${quotes.length} citações fora da fonte: ${listShort(missing)}`,
        score,
      );
}
