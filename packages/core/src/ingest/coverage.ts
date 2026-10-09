import type { Coverage } from "@narnia-jobs/shared";
import type { Candidate } from "./sources/github/highlights";

/**
 * Incremental e segunda rodada (F03-3 §7): cada análise salva o mapa de cobertura (arquivos lidos, temas). Com
 * commit novo a reanálise é incremental (relatório anterior + diff); com o mesmo commit a UI pergunta por uma
 * segunda rodada: aprofundar o já analisado ou cobrir o que ficou de fora.
 */
export type ReanalysisKind = "full" | "incremental" | "second_round";

export function reanalysisKind(i: {
  previous: { headSha: string | null } | null;
  headSha: string | null;
}): ReanalysisKind {
  if (!i.previous?.headSha) return "full";
  return i.previous.headSha === i.headSha ? "second_round" : "incremental";
}

export function mergeCoverage(a: Coverage, b: Coverage): Coverage {
  const uniq = (xs: string[]) => [...new Set(xs)].sort((x, y) => x.localeCompare(y));
  return { files: uniq([...a.files, ...b.files]), topics: uniq([...a.topics, ...b.topics]) };
}

/** Na segunda rodada, "aprofundar" relê os arquivos cobertos com mais conteúdo por arquivo. */
export const DEEPEN_CHARS_FACTOR = 2;

export function selectSecondRound(i: {
  kind: "deepen" | "cover";
  candidates: Candidate[];
  coverage: Coverage;
  max: number;
}): Candidate[] {
  const seen = new Set(i.coverage.files);
  return i.candidates
    .filter((c) => (i.kind === "cover" ? !seen.has(c.path) : seen.has(c.path)))
    .slice(0, Math.max(0, i.max));
}
