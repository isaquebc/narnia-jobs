import { collectByKey, type EvalParams, type EvalResult, jsonOf, listShort, result } from "./lib";

/**
 * CV e carta (F05): toda origem citada (`factId`/`factIds[].id`) existe no resumo enviado, e nenhum termo de `gaps`
 * (pedido da vaga sem evidência) aparece no texto, a não ser no parágrafo `gaps` da carta (F05-20).
 */
function briefOf(p: EvalParams): Record<string, unknown> {
  try {
    return JSON.parse(String(p.input?.brief_json ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function cvFactIds(p: EvalParams): EvalResult {
  const known = new Set(collectByKey(briefOf(p), "id").map(String));
  const out = jsonOf(p.output);
  const used = [
    ...collectByKey(out, "factId").map(String),
    ...collectByKey(out, "factIds").flatMap((v) =>
      Array.isArray(v) ? v.map((r) => String((r as { id?: unknown })?.id ?? "")) : [],
    ),
  ];
  const unknown = [...new Set(used.filter((id) => !known.has(id)))];
  return unknown.length === 0
    ? result(true, `${used.length} origens citadas, todas do resumo`)
    : result(false, `origens que não estão no resumo: ${listShort(unknown)}`);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function cvNoGapTerms(p: EvalParams): EvalResult {
  const gaps = (briefOf(p).gaps as unknown[] | undefined)?.map(String) ?? [];
  const out = jsonOf(p.output) as
    | {
        paragraphs?: Array<{ role?: string; text?: string }>;
        adjacent?: Array<{ asked?: string }>;
      }
    | undefined;
  // `adjacent[].asked` registra justamente o termo pedido pela vaga; o que conta é o texto do documento
  const scoped = out?.paragraphs
    ? { ...out, paragraphs: out.paragraphs.filter((x) => x.role !== "gaps") }
    : out?.adjacent
      ? { ...out, adjacent: out.adjacent.map((a) => ({ ...a, asked: "" })) }
      : out;
  const text = fold(JSON.stringify(scoped ?? ""));
  const found = gaps.filter((g) => {
    const k = fold(g).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return k && new RegExp(`(?<![\\p{L}\\p{N}])${k}(?![\\p{L}\\p{N}])`, "u").test(text);
  });
  return found.length === 0
    ? result(
        true,
        gaps.length
          ? `nenhum dos ${gaps.length} termos sem evidência aparece`
          : "sem lacunas no resumo",
      )
    : result(false, `termos sem evidência no texto: ${listShort(found)}`);
}
