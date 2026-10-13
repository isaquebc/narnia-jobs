import { type EvalParams, type EvalResult, jsonOf, listShort, result } from "./lib";

/** Escolha de arquivos: no máximo `max_files` e só caminhos que existem na árvore (ou nos candidatos). */
export function pickFilesLimits(p: EvalParams): EvalResult {
  const max = Number(p.input?.max_files ?? 0);
  const known = new Set(
    `${String(p.input?.tree ?? "")}\n${String(p.input?.candidates ?? "")}`
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const files = (
    (jsonOf(p.output) as { files?: Array<{ path?: string }> } | undefined)?.files ?? []
  ).map((f) => String(f.path ?? ""));
  const problems: string[] = [];
  if (max > 0 && files.length > max) problems.push(`${files.length} arquivos (máximo ${max})`);
  const unknown = files.filter((f) => !known.has(f));
  if (unknown.length > 0) problems.push(`fora da árvore: ${listShort(unknown)}`);
  return problems.length === 0
    ? result(true, `${files.length} arquivos, todos na árvore`)
    : result(false, problems.join("; "));
}
