import { collectStrings, type EvalParams, type EvalResult, jsonOf, result, textOf } from "./lib";

const PT =
  /\b(?:o|a|os|as|de|do|da|dos|das|em|no|na|com|para|por|que|não|uma?|é|são|mais|como|seu|sua)\b/g;
const EN = /\b(?:the|of|and|to|in|with|for|is|are|has|have|was|on|by|this|that|an?)\b/g;

/** Com `input.locale` pt-*, os textos livres (campos de `fields`) saem em português. */
export function language(p: EvalParams, config: { fields: string[] }): EvalResult {
  const locale = String(p.input?.locale ?? "pt-BR");
  if (!locale.toLowerCase().startsWith("pt"))
    return result(true, `idioma ${locale}: não se aplica`);
  const value = jsonOf(p.output);
  const texts = value === undefined ? [textOf(p.output)] : collectStrings(value, config.fields);
  const text = texts.join(" ").toLowerCase();
  if (text.trim().length < 20) return result(true, "pouco texto livre para avaliar");
  const pt = (text.match(PT) ?? []).length;
  const en = (text.match(EN) ?? []).length;
  return pt >= en
    ? result(true, `português (${pt} marcas pt × ${en} en)`)
    : result(false, `parece inglês (${pt} marcas pt × ${en} en)`);
}
