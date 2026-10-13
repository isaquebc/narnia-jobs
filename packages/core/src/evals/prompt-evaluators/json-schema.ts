import { type EvalParams, type EvalResult, jsonOf, listShort, result, validateSchema } from "./lib";

/** A resposta é JSON e segue o schema de saída do prompt. */
export function jsonSchema(p: EvalParams, config: { schema: Record<string, unknown> }): EvalResult {
  const value = jsonOf(p.output);
  if (value === undefined) return result(false, "a resposta não é JSON");
  const errors = validateSchema(config.schema, value);
  return errors.length === 0
    ? result(true, "JSON válido no schema do prompt")
    : result(false, `fora do schema: ${listShort(errors)}`);
}
