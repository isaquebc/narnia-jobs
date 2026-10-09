import { RepoGroupSchema, type RepoPreviewItem } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  collectRepo,
  fetchCompare,
  fetchFiles,
  groupRepos,
  previewGithub,
  repoRelevance,
  SELECTION_WARNING_THRESHOLD,
  selectedCount,
  selectionWarning,
  summarizeCompare,
} from "../../../src/ingest/sources/github/collect";
import { createGhClient } from "../../../src/ingest/sources/github/gh";
import { BASE_SHA, fakeGh, HEAD_SHA, LOGIN, notFound } from "../../fixtures/github/fake-gh";

const unauth = { stdout: "", stderr: "gh: Requires authentication (HTTP 401)", code: 1 };

function item(i: number, extra: Partial<RepoPreviewItem> = {}): RepoPreviewItem {
  return {
    fullName: `ana/r${i}`,
    name: `r${i}`,
    owner: "ana",
    url: `https://github.com/ana/r${i}`,
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    stars: 0,
    pushedAt: `2026-0${(i % 9) + 1}-${String(10 + (i % 18)).padStart(2, "0")}T10:00:00Z`,
    selected: false,
    ...extra,
  };
}

describe("F03/M2 collect: seletor de repositórios (F03-2)", () => {
  it("análise privada: Pessoais + uma linha por organização, com privados", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const out = await previewGithub(gh, { mode: "private" });
    expect(out.login).toBe(LOGIN);
    expect(out.authenticated).toBe(true);
    expect(out.groups.map((g) => [g.key, g.kind, g.total])).toEqual([
      ["personal", "personal", 12],
      ["acme-labs", "org", 3],
      ["coletivo-oss", "org", 2],
    ]);
    for (const g of out.groups) RepoGroupSchema.parse(g);
    expect(out.groups[0]?.repos.some((r) => r.isPrivate)).toBe(true);
  });

  it("forks e arquivados aparecem desmarcados; com menos de 10 elegíveis, todos os outros marcados", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const personal = (await previewGithub(gh, { mode: "private" })).groups[0];
    const unselected = personal?.repos.filter((r) => !r.selected).map((r) => r.name);
    expect(unselected?.sort()).toEqual(["app-legado", "awesome-go", "react"]);
    expect(personal?.selected).toBe(9);
  });

  it("com mais de 10 elegíveis num grupo, pré-seleciona os 10 de push mais recente", () => {
    const repos = Array.from({ length: 14 }, (_, i) => item(i));
    const [group] = groupRepos({ login: "ana", personal: repos, orgs: [] });
    const chosen = group?.repos.filter((r) => r.selected) ?? [];
    expect(chosen).toHaveLength(10);
    const minChosen = Math.min(...chosen.map((r) => Date.parse(r.pushedAt ?? "")));
    const maxLeft = Math.max(
      ...(group?.repos.filter((r) => !r.selected).map((r) => Date.parse(r.pushedAt ?? "")) ?? []),
    );
    expect(minChosen).toBeGreaterThanOrEqual(maxLeft);
    expect(group?.selected).toBe(10);
  });

  it("aviso quando o total selecionado passa de 10, somando os grupos", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const { groups } = await previewGithub(gh, { mode: "private" });
    expect(SELECTION_WARNING_THRESHOLD).toBe(10);
    expect(selectedCount(groups)).toBe(14);
    expect(selectionWarning(groups)).toBe(true);
    expect(selectionWarning(groupRepos({ login: "ana", personal: [item(1)], orgs: [] }))).toBe(
      false,
    );
  });

  it("análise pública: só repositórios públicos, inclusive das organizações", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const out = await previewGithub(gh, { mode: "public" });
    const all = out.groups.flatMap((g) => g.repos);
    expect(all.every((r) => !r.isPrivate)).toBe(true);
    expect(out.groups.map((g) => g.total)).toEqual([11, 2, 2]);
  });

  it("análise pública funciona sem login quando o usuário informa o login", async () => {
    const gh = createGhClient({ exec: fakeGh({ user: unauth }).exec });
    const out = await previewGithub(gh, { mode: "public", login: LOGIN });
    expect(out.authenticated).toBe(false);
    expect(out.groups[0]?.total).toBe(11);
    await expect(previewGithub(gh, { mode: "public" })).rejects.toMatchObject({
      code: "not_authenticated",
    });
    await expect(previewGithub(gh, { mode: "private", login: LOGIN })).rejects.toMatchObject({
      code: "not_authenticated",
    });
  });
});

describe("F03/M2 collect: coleta de um repositório (0 tokens)", () => {
  it("metadados, linguagens, tópicos, head, README, árvore e commits do usuário", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const c = await collectRepo(gh, "ana-exemplo/api-pagamentos", {
      login: LOGIN,
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(c.repo).toMatchObject({
      fullName: "ana-exemplo/api-pagamentos",
      owner: LOGIN,
      defaultBranch: "main",
      headSha: HEAD_SHA,
      stars: 42,
      topics: ["api", "payments", "nodejs"],
      isFork: false,
    });
    expect(c.repo.languages).toEqual({ TypeScript: 52000, PLpgSQL: 4000, Dockerfile: 600 });
    expect(c.readme).toContain("estornos parciais");
    expect(c.tree.truncated).toBe(false);
    expect(c.tree.entries).toHaveLength(16);
    expect(c.tree.entries.every((e) => e.size >= 0)).toBe(true);
    expect(c.userCommits.count).toBe(8);
    expect(c.userCommits.messages[0]).toBe("feat: estorno parcial");
    expect(c.repo.relevance).toBeGreaterThan(0);
    expect(c.repo.relevance).toBeLessThanOrEqual(1);
  });

  it("README ausente → null, sem falhar a coleta", async () => {
    const gh = createGhClient({
      exec: fakeGh({ "repos/ana-exemplo/api-pagamentos/readme": notFound }).exec,
    });
    const c = await collectRepo(gh, "ana-exemplo/api-pagamentos", { login: LOGIN });
    expect(c.readme).toBeNull();
  });

  it("árvore truncada pela API fica marcada", async () => {
    const tree = {
      sha: HEAD_SHA,
      tree: [{ path: "a.ts", type: "blob", size: 10 }],
      truncated: true,
    };
    const gh = createGhClient({
      exec: fakeGh({
        [`repos/ana-exemplo/api-pagamentos/git/trees/${HEAD_SHA}?recursive=1`]: {
          stdout: JSON.stringify(tree),
          stderr: "",
          code: 0,
        },
      }).exec,
    });
    const c = await collectRepo(gh, "ana-exemplo/api-pagamentos", { login: LOGIN });
    expect(c.tree.truncated).toBe(true);
  });

  it("relevância: estrelas, commits do usuário, recência, não-fork e README contam; determinística", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const base = {
      stars: 10,
      userCommits: 20,
      pushedAt: "2026-09-01T00:00:00Z",
      isFork: false,
      hasReadme: true,
    };
    const r = repoRelevance(base, now);
    expect(repoRelevance(base, now)).toBe(r);
    expect(repoRelevance({ ...base, isFork: true }, now)).toBeLessThan(r);
    expect(repoRelevance({ ...base, hasReadme: false }, now)).toBeLessThan(r);
    expect(repoRelevance({ ...base, pushedAt: "2020-01-01T00:00:00Z" }, now)).toBeLessThan(r);
    expect(
      repoRelevance({ ...base, stars: 0, userCommits: 0, pushedAt: null }, now),
    ).toBeGreaterThanOrEqual(0);
  });

  it("fetchFiles traz só os caminhos pedidos, corta no máximo e pula os inexistentes", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const files = await fetchFiles(
      gh,
      "ana-exemplo/api-pagamentos",
      HEAD_SHA,
      ["package.json", "src/server.ts", "nao/existe.ts"],
      { maxChars: 200 },
    );
    expect(files.map((f) => f.path)).toEqual(["package.json", "src/server.ts"]);
    expect(files[0]?.truncated).toBe(false);
    expect(files[1]?.truncated).toBe(true);
    expect(files[1]?.content.length).toBeLessThanOrEqual(200);
  });

  it("compare desde o SHA salvo: mensagens, arquivos alterados e patch truncado no resumo", async () => {
    const gh = createGhClient({ exec: fakeGh().exec });
    const cmp = await fetchCompare(gh, "ana-exemplo/api-pagamentos", BASE_SHA, HEAD_SHA);
    expect(cmp.aheadBy).toBe(2);
    expect(cmp.messages).toEqual(["feat: estorno parcial", "fix: arredondamento em centavos"]);
    expect(cmp.files.map((f) => [f.path, f.status])).toEqual([
      ["src/routes/refunds.ts", "modified"],
      ["test/refunds.test.ts", "added"],
    ]);
    const text = summarizeCompare(cmp, { maxPatchChars: 300 });
    expect(text).toContain("feat: estorno parcial");
    expect(text).toContain("src/routes/refunds.ts (modified, +40 -5)");
    expect(text).toContain("[patch truncado]");
    expect(text.length).toBeLessThan(1500);
  });
});
