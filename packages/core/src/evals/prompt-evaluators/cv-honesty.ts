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

/**
 * Cargo de cada experiência e curso e grau da formação no idioma certo: com os dados no idioma do documento
 * (`sourceLocale` = `locale`), exatamente como nos dados; em outro idioma, traduzidos (o que tem cara do idioma dos dados
 * não pode ficar igual). O revisor reprova os dois desvios. Nota pela fração.
 */
export function cvSourceTitles(p: EvalParams): EvalResult {
  const b = briefOf(p) as {
    locale?: string;
    sourceLocale?: string | null;
    experiences?: Array<{ id?: string; title?: string }>;
    education?: Array<{ id?: string; course?: string | null; degree?: string | null }>;
  };
  if (!b.sourceLocale || !b.locale)
    return result(true, "idioma dos dados desconhecido: não se aplica");
  const translate = b.sourceLocale !== b.locale;
  const out = jsonOf(p.output) as
    | {
        experiences?: Array<{ factId?: string; title?: string }>;
        education?: Array<{ factId?: string; course?: string | null; degree?: string | null }>;
      }
    | undefined;
  const pairs: Array<[string, string]> = [];
  for (const e of out?.experiences ?? []) {
    const data = b.experiences?.find((x) => x.id === e.factId)?.title;
    if (data) pairs.push([data, String(e.title ?? "")]);
  }
  for (const e of out?.education ?? []) {
    const data = b.education?.find((x) => x.id === e.factId);
    if (data?.course) pairs.push([data.course, String(e.course ?? "")]);
    if (data?.degree) pairs.push([data.degree, String(e.degree ?? "")]);
  }
  if (pairs.length === 0) return result(true, "sem cargo nem formação para conferir");
  // mesmo idioma: igual ao dado; idiomas diferentes: o que tem cara do idioma dos dados não pode ficar igual
  const source = b.sourceLocale;
  const wrong = pairs.filter(([data, written]) =>
    translate
      ? data.trim() === written.trim() && looksLike(data, source)
      : data.trim() !== written.trim(),
  );
  const score = (pairs.length - wrong.length) / pairs.length;
  if (wrong.length === 0)
    return result(
      true,
      translate
        ? `${pairs.length} cargos e cursos no idioma do documento`
        : `${pairs.length} cargos e cursos iguais aos dados`,
      1,
    );
  return translate
    ? result(
        false,
        `sem tradução para ${b.locale}: ${listShort(wrong.map(([d]) => `"${d}"`))}`,
        score,
      )
    : result(
        false,
        `diferentes dos dados: ${listShort(wrong.map(([d, w]) => `"${w}" (dado: "${d}")`))}`,
        score,
      );
}

const PT_MARKS =
  /[ãõçáéíóúâêô]|\b(?:de|da|do|em|e|engenheir[oa]|desenvolvedora?|analista|pleno|j[uú]nior|gerente|coordenadora?|bacharelado|tecn[oó]logo|mestrado|doutorado|remoto)\b/i;
const EN_MARKS = /\b(?:of|and|in|engineer|developer|manager|bachelor|master|science|remote)\b/i;

/** O texto tem cara do idioma dos dados (marca típica); nomes neutros como "Tech Lead" não têm. */
function looksLike(text: string, locale: string): boolean {
  return locale.startsWith("pt") ? PT_MARKS.test(text) : EN_MARKS.test(text);
}

/** Carta (F05-21): de 250 a 400 palavras somando os parágrafos, a mesma conta da montagem (fora disso, regera). */
export function letterWordCount(p: EvalParams): EvalResult {
  const out = jsonOf(p.output) as { paragraphs?: Array<{ text?: string }> } | undefined;
  const words = (out?.paragraphs ?? []).reduce(
    (n, x) =>
      n +
      String(x.text ?? "")
        .split(/\s+/)
        .filter(Boolean).length,
    0,
  );
  return words >= 250 && words <= 400
    ? result(true, `${words} palavras`)
    : result(false, `${words} palavras (de 250 a 400)`);
}
