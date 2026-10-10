import { GithubMetricsSchema } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../../src/db";
import { createGhClient } from "../../../src/ingest/sources/github/gh";
import {
  collectGithubMetrics,
  collectRepoMetrics,
  metricsTable,
  persistMetrics,
  sumMetrics,
} from "../../../src/ingest/sources/github/metrics";
import { fakeGh, LOGIN } from "../../fixtures/github/fake-gh";

const gh = () => createGhClient({ exec: fakeGh().exec });

describe("F03/M2 metrics: análise quantitativa sem tokens (F03-3 §3)", () => {
  it("por repositório: commits do usuário, PRs por estado, revisões, issues", async () => {
    const m = await collectRepoMetrics(gh(), {
      fullName: "ana-exemplo/api-pagamentos",
      login: LOGIN,
      userId: "U_ana",
    });
    expect(GithubMetricsSchema.parse(m)).toEqual({
      commits: 87,
      prsOpened: 37,
      prsMerged: 31,
      prsClosed: 4,
      reviewsApproved: 12,
      issuesOpened: 9,
      issuesClosed: 7,
    });
  });

  it("repositório sem branch padrão (vazio) tem 0 commits", async () => {
    const m = await collectRepoMetrics(gh(), {
      fullName: "ana-exemplo/blog",
      login: LOGIN,
      userId: "U_ana",
    });
    expect(m.commits).toBe(0);
  });

  it("recusa login ou repositório com caracteres fora do permitido (consulta montada com eles)", async () => {
    await expect(
      collectRepoMetrics(gh(), { fullName: 'x/y" OR', login: LOGIN, userId: "U" }),
    ).rejects.toThrow(/inválido/);
    await expect(collectGithubMetrics(gh(), { login: "a b", repos: [] })).rejects.toThrow(
      /inválido/,
    );
  });

  it("por ano (contributionsCollection + buscas) e global com open source e contribuições em terceiros", async () => {
    const out = await collectGithubMetrics(gh(), {
      login: LOGIN,
      repos: ["ana-exemplo/api-pagamentos", "ana-exemplo/painel-web"],
    });
    expect(out.userId).toBe("U_ana");
    expect(out.years.map((y) => y.year)).toEqual([2026, 2025, 2024]);
    expect(out.years[0]?.metrics).toEqual({
      commits: 412,
      prsOpened: 58,
      prsMerged: 49,
      prsClosed: 5,
      reviewsApproved: 38,
      issuesOpened: 21,
      issuesClosed: 15,
    });
    expect(out.global).toMatchObject({
      commits: 832,
      prsOpened: 110,
      prsMerged: 94,
      ossRepos: 9,
      externalContributions: 6,
    });
    expect(out.repos.map((r) => [r.fullName, r.metrics.commits])).toEqual([
      ["ana-exemplo/api-pagamentos", 87],
      ["ana-exemplo/painel-web", 40],
    ]);
  });

  it("um repositório que falha não derruba os outros", async () => {
    const out = await collectGithubMetrics(gh(), {
      login: LOGIN,
      repos: ["ana-exemplo/api-pagamentos", "ana-exemplo/nao-existe"],
    });
    expect(out.repos.map((r) => r.fullName)).toEqual(["ana-exemplo/api-pagamentos"]);
    expect(out.failed).toEqual(["ana-exemplo/nao-existe"]);
  });

  it("sumMetrics soma campo a campo; tabela compacta para o modelo", async () => {
    const zero = {
      commits: 0,
      prsOpened: 0,
      prsMerged: 0,
      prsClosed: 0,
      reviewsApproved: 0,
      issuesOpened: 0,
      issuesClosed: 0,
    };
    expect(
      sumMetrics([
        { ...zero, commits: 2 },
        { ...zero, commits: 3, prsMerged: 1 },
      ]),
    ).toEqual({
      ...zero,
      commits: 5,
      prsMerged: 1,
    });
    const out = await collectGithubMetrics(gh(), {
      login: LOGIN,
      repos: ["ana-exemplo/api-pagamentos"],
    });
    const table = metricsTable(out);
    expect(table).toContain("| total | 832 |");
    expect(table).toContain("| 2026 | 412 |");
    expect(table).toContain("| ana-exemplo/api-pagamentos | 87 |");
    expect(table).toContain("open source próprios: 9");
    expect(table.length).toBeLessThan(2000);
  });

  it("persistMetrics grava global, por ano e por repositório (com id do repo)", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const repo = repos.repos.upsert({
      fullName: "ana-exemplo/api-pagamentos",
      owner: LOGIN,
      url: "https://github.com/ana-exemplo/api-pagamentos",
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      languages: {},
      topics: [],
      stars: 0,
      pushedAt: null,
      defaultBranch: "main",
      headSha: null,
      relevance: null,
    });
    const out = await collectGithubMetrics(gh(), { login: LOGIN, repos: [repo.fullName] });
    persistMetrics(repos, out);
    expect(repos.githubMetrics.get({ scope: "global" })?.commits).toBe(832);
    expect(repos.githubMetrics.get({ scope: "year", year: 2025 })?.commits).toBe(300);
    expect(repos.githubMetrics.get({ scope: "repo", repoId: repo.id })?.commits).toBe(87);
  });
});

describe("F03/M5 métricas sem login (análise pública anônima, F03-2)", () => {
  it("GraphQL exige login: sem login as métricas são puladas, sem derrubar a coleta", async () => {
    const anon = createGhClient({ exec: fakeGh({ state: { authenticated: false } }).exec });
    const r = await collectGithubMetrics(anon, {
      login: LOGIN,
      repos: ["ana-exemplo/api-pagamentos"],
    });
    expect(r.unavailable).toBe("not_authenticated");
    expect(r.years).toEqual([]);
    expect(r.repos).toEqual([]);
    expect(metricsTable(r)).toContain("indisponíveis sem login");
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    persistMetrics(repos, r);
    expect(repos.githubMetrics.list()).toEqual([]);
  });
});
