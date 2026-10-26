import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approvedPlugins } from "../src/evals/approved-plugin";

/**
 * Gate robusto (2026-10-25) · o lado A do pairwise roda de novo com o plugin da versão aprovada: o commit que gravou a
 * aprovada guarda os prompts dela. Vale o commit cujo plugin reproduz as dependências gravadas no caso.
 */
describe("gate robusto · plugin da versão aprovada pelo git", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd,
      stdio: "pipe",
    });

  it("extrai o plugin de cada commit que mexeu na aprovada, do mais novo ao mais velho", () => {
    const root = mkdtempSync(join(tmpdir(), "narnia-approved-plugin-"));
    dirs.push(root);
    git(root, "init", "-q");
    mkdirSync(join(root, "plugin/skills/s"), { recursive: true });
    mkdirSync(join(root, "evals/approved"), { recursive: true });
    const skill = join(root, "plugin/skills/s/SKILL.md");
    const approved = join(root, "evals/approved/narnia-chat.jsonl");
    writeFileSync(skill, "v1");
    writeFileSync(approved, "a1");
    git(root, "add", ".");
    git(root, "commit", "-qm", "1");
    writeFileSync(skill, "v2");
    writeFileSync(approved, "a2");
    git(root, "add", ".");
    git(root, "commit", "-qm", "2");
    writeFileSync(skill, "v3 (em andamento)");

    const found = approvedPlugins(root, "narnia-chat");
    dirs.push(...found.map((f) => f.dir));
    expect(found.map((f) => readFileSync(join(f.dir, "skills/s/SKILL.md"), "utf8"))).toEqual([
      "v2",
      "v1",
    ]);
    expect(found[0]?.commit).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("sem git ou sem histórico: lista vazia (o lado A fica com a saída guardada)", () => {
    const root = mkdtempSync(join(tmpdir(), "narnia-approved-plugin-"));
    dirs.push(root);
    expect(approvedPlugins(root, "narnia-chat")).toEqual([]);
  });
});
