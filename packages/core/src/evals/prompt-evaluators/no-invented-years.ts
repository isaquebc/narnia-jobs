import { type EvalParams, type EvalResult, result, sourceText, textOf, yearsIn } from "./lib";

/** Anos citados na resposta precisam existir na fonte do exemplo (nada de datas inventadas). */
export function noInventedYears(p: EvalParams, config: { sourceFields: string[] }): EvalResult {
  const known = new Set(yearsIn(sourceText(p.input, config.sourceFields)));
  const unknown = yearsIn(textOf(p.output)).filter((y) => !known.has(y));
  return unknown.length === 0
    ? result(true, "sem anos fora da fonte")
    : result(false, `anos que não estão na fonte: ${unknown.join(", ")}`);
}
