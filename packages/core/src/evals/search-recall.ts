import { z } from "zod";

/**
 * Benchmark de recall da busca de fatos (F04-fix-fundamentacao, R0, 2026-10-29): cada caso é uma pergunta como o
 * recrutador faria e os fatos que deveriam voltar, pelo tipo e por um trecho da linha que a tool devolve (sem ids, que
 * mudam a cada fixture). Mede quanto a busca perde por tipo de pergunta.
 */
export const RECALL_CATEGORIES = [
  "exato",
  "agrupado",
  "traducao",
  "sinonimo",
  "semantico",
] as const;

const RecallCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(RECALL_CATEGORIES),
  query: z.string().min(1),
  expected: z.array(z.object({ kind: z.string().min(1), match: z.string().min(1) })).min(1),
});
export type RecallCase = z.infer<typeof RecallCaseSchema>;

/** A busca medida: devolve as linhas na ordem (a `fact_search`, com o limite padrão dela). */
export type RecallSearch = (query: string) => Promise<Array<{ kind: string; line: string }>>;

export interface RecallReport {
  cases: Array<{
    id: string;
    category: RecallCase["category"];
    recall: number;
    found: number;
    missing: string[];
  }>;
  /** Média do recall dos casos de cada tipo. */
  byCategory: Partial<Record<RecallCase["category"], number>>;
  /** Fatos achados / fatos esperados, em todos os casos. */
  overall: number;
}

export function parseRecallCases(text: string): RecallCase[] {
  return text
    .split("\n")
    .map((l, i) => [l.trim(), i + 1] as const)
    .filter(([l]) => l)
    .map(([l, n]) => {
      const r = RecallCaseSchema.safeParse(JSON.parse(l));
      if (!r.success) throw new Error(`recall: linha ${n} inválida: ${r.error.message}`);
      return r.data;
    });
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export async function factSearchRecall(
  cases: RecallCase[],
  search: RecallSearch,
): Promise<RecallReport> {
  const out: RecallReport["cases"] = [];
  for (const c of cases) {
    const hits = await search(c.query);
    const missing = c.expected.filter(
      (e) => !hits.some((h) => h.kind === e.kind && norm(h.line).includes(norm(e.match))),
    );
    const found = c.expected.length - missing.length;
    out.push({
      id: c.id,
      category: c.category,
      recall: found / c.expected.length,
      found,
      missing: missing.map((m) => `${m.kind}: ${m.match}`),
    });
  }
  const byCategory: RecallReport["byCategory"] = {};
  for (const cat of RECALL_CATEGORIES) {
    const list = out.filter((c) => c.category === cat);
    if (list.length) byCategory[cat] = list.reduce((s, c) => s + c.recall, 0) / list.length;
  }
  const expected = cases.reduce((s, c) => s + c.expected.length, 0);
  return {
    cases: out,
    byCategory,
    overall: expected ? out.reduce((s, c) => s + c.found, 0) / expected : 0,
  };
}
