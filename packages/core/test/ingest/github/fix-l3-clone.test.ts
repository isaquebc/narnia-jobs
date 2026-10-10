import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { collectRepo, createCloneTreeLister } from "../../../src/ingest/sources/github/collect";
import type { GhClient } from "../../../src/ingest/sources/github/gh";

/** Plano de correções F03, item 13: árvore truncada → clone raso sem blobs, só a lista de arquivos. */
function stubGh(truncated: boolean): GhClient {
  const json = async (path: string) => {
    if (path.endsWith("/languages")) return {};
    return {
      default_branch: "main",
      stargazers_count: 0,
      topics: [],
      owner: { login: "ana-exemplo" },
      full_name: "ana-exemplo/grande",
      name: "grande",
    };
  };
  const tryJson = async (path: string) => {
    if (path.includes("/git/trees/"))
      return { tree: [{ path: "README.md", type: "blob", size: 10 }], truncated };
    if (path.includes("/commits/main")) return { sha: "abc123" };
    if (path.includes("commits?author=")) return [];
    return null;
  };
  return {
    json: json as GhClient["json"],
    raw: async () => "",
    tryJson: tryJson as GhClient["tryJson"],
    tryRaw: async () => null,
    graphql: async () => ({}) as never,
  };
}

describe("F03 fix L3 · item 13: clone de fallback", () => {
  it("createCloneTreeLister clona raso sem blobs nem checkout, lista os arquivos e apaga a pasta temporária", async () => {
    const calls: string[][] = [];
    const exec = vi.fn(async (args: string[]) => {
      calls.push(args);
      return { stdout: "", stderr: "", code: 0 };
    });
    const git = vi.fn(async () => "README.md\nsrc/index.ts\nsrc/deep/a.ts\n");
    const list = createCloneTreeLister({ exec, git });
    const entries = await list("ana-exemplo/grande");
    expect(entries.map((e) => e.path)).toEqual(["README.md", "src/index.ts", "src/deep/a.ts"]);
    const clone = calls[0] as string[];
    expect(clone.slice(0, 3)).toEqual(["repo", "clone", "ana-exemplo/grande"]);
    expect(clone.slice(4)).toEqual(["--", "--depth", "1", "--filter=blob:none", "--no-checkout"]);
    expect(existsSync(clone[3] as string)).toBe(false);
  });

  it("collectRepo usa o clone só quando a árvore da API vem truncada", async () => {
    const cloneTree = vi.fn(async () => [
      { path: "README.md", size: 0 },
      { path: "src/x.ts", size: 0 },
    ]);
    const truncated = await collectRepo(stubGh(true), "ana-exemplo/grande", {
      login: "ana-exemplo",
      cloneTree,
    });
    expect(cloneTree).toHaveBeenCalledWith("ana-exemplo/grande");
    expect(truncated.tree.truncated).toBe(false);
    expect(truncated.tree.entries.map((e) => e.path)).toEqual(["README.md", "src/x.ts"]);
    expect(truncated.tree.entries[0]?.size).toBe(10); // tamanho conhecido pela API é preservado

    cloneTree.mockClear();
    await collectRepo(stubGh(false), "ana-exemplo/pequeno", { login: "ana-exemplo", cloneTree });
    expect(cloneTree).not.toHaveBeenCalled();
  });
});
