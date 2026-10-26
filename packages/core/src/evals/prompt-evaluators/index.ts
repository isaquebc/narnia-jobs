/** Avaliadores de código dos prompts estruturados (M3): módulos puros, publicados no Phoenix como arquivo único. */
export { answerChecks, locateKinds, locateRefs, roleplayChecks } from "./application-locate";
export { checkVerdicts } from "./check-verdicts";
export { cvFactIds, cvNoGapTerms, cvSourceTitles, letterWordCount } from "./cv-honesty";
export { jsonSchema } from "./json-schema";
export { language } from "./language";
export type { EvalParams, EvalResult } from "./lib";
export { jsonOf, textOf, validateSchema } from "./lib";
export { literalQuotes } from "./literal-quotes";
export { motivationChecks } from "./motivations";
export { noInventedYears } from "./no-invented-years";
export { pickFilesLimits } from "./pick-files";
export { referenceCoverage } from "./reference-coverage";
export { supportingIds } from "./supporting-ids";

/** Pasta dos módulos (a publicação lê o texto de cada um). */
export const PROMPT_EVALUATORS_DIR = new URL("./", import.meta.url);
