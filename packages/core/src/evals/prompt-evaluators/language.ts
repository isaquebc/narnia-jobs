import { collectStrings, type EvalParams, type EvalResult, jsonOf, result, textOf } from "./lib";

const PT =
  /\b(?:o|a|os|as|de|do|da|dos|das|em|no|na|com|para|por|que|não|uma?|é|são|mais|como|seu|sua)\b/g;
const EN = /\b(?:the|of|and|to|in|with|for|is|are|has|have|was|on|by|this|that|an?)\b/g;

/** Idioma do resumo do CV (F05): o documento sai no idioma da vaga, que vem dentro de `brief_json`. */
function briefLocale(p: EvalParams): string | null {
  try {
    const b = JSON.parse(String(p.input?.brief_json ?? "null")) as { locale?: unknown } | null;
    return typeof b?.locale === "string" ? b.locale : null;
  } catch {
    return null;
  }
}

/**
 * Com `input.locale` pt-*, os textos livres (campos de `fields`) saem em português. No CV e na carta (F05) o idioma vem
 * do resumo, e en-US também é conferido (o documento sai no idioma da vaga, F05-16).
 */
export function language(p: EvalParams, config: { fields: string[] }): EvalResult {
  const fromBrief = briefLocale(p);
  const locale = String(p.input?.locale ?? fromBrief ?? "pt-BR");
  const english = fromBrief !== null && locale.toLowerCase().startsWith("en");
  if (!locale.toLowerCase().startsWith("pt") && !english)
    return result(true, `idioma ${locale}: não se aplica`);
  const value = jsonOf(p.output);
  const texts = value === undefined ? [textOf(p.output)] : collectStrings(value, config.fields);
  const text = texts.join(" ").toLowerCase();
  if (text.trim().length < 20) return result(true, "pouco texto livre para avaliar");
  const pt = (text.match(PT) ?? []).length;
  const en = (text.match(EN) ?? []).length;
  if (english)
    return en >= pt
      ? result(true, `inglês (${en} marcas en × ${pt} pt)`)
      : result(false, `parece português (${en} marcas en × ${pt} pt)`);
  return pt >= en
    ? result(true, `português (${pt} marcas pt × ${en} en)`)
    : result(false, `parece inglês (${pt} marcas pt × ${en} en)`);
}
