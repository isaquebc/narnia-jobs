import { collectByKey, type EvalParams, type EvalResult, jsonOf, listShort, result } from "./lib";

/** Sugestões de perfil: `supportingFactIds` só com ids que estão no histórico enviado. */
export function supportingIds(p: EvalParams): EvalResult {
  let history: unknown = {};
  try {
    history = JSON.parse(String(p.input?.history_json ?? "{}"));
  } catch {
    // histórico inválido: todo id fica desconhecido
  }
  const known = new Set(collectByKey(history, "id").map(String));
  const used = collectByKey(jsonOf(p.output), "supportingFactIds").flatMap((v) =>
    Array.isArray(v) ? v.map(String) : [],
  );
  const unknown = [...new Set(used.filter((id) => !known.has(id)))];
  return unknown.length === 0
    ? result(true, `${used.length} ids de apoio, todos do histórico`)
    : result(false, `ids que não estão no histórico: ${listShort(unknown)}`);
}
