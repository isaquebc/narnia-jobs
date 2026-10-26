import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Plugin das versões aprovadas (gate robusto, 2026-10-25): o pairwise compara amostras novas dos dois lados, e o lado A
 * roda com os prompts da versão aprovada. Eles estão no commit que gravou `evals/approved/<chave>.jsonl` (prompts e
 * aprovada entram no mesmo commit); quem chama confere, pelas dependências gravadas em cada caso, qual commit vale.
 * Devolve do mais novo ao mais velho (até `limit`), cada um extraído numa pasta temporária (quem chama apaga).
 */
export function approvedPlugins(
  root: string,
  key: string,
  limit = 5,
): Array<{ commit: string; dir: string }> {
  const git = (args: string[], input?: Buffer) =>
    execFileSync("git", args, { cwd: root, stdio: ["pipe", "pipe", "ignore"], input });
  let commits: string[];
  try {
    commits = git([
      "log",
      `-${limit}`,
      "--format=%h",
      "--",
      `evals/approved/${key.replace(/[^\w.-]+/g, "_")}.jsonl`,
    ])
      .toString()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
  return commits.map((commit) => {
    const dir = mkdtempSync(join(tmpdir(), `narnia-approved-${commit}-`));
    const tar = git(["archive", commit, "plugin"]);
    execFileSync("tar", ["-x", "--strip-components=1", "-C", dir], { input: tar });
    return { commit, dir };
  });
}
