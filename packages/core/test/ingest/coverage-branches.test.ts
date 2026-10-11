import type { FactProposal } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { IngestError } from "../../src/ingest/errors";
import { syncRunNotifications } from "../../src/ingest/notify";
import {
  canonicalSkill,
  existingFacts,
  normalizeCompany,
  reconcileProposals,
  suggestProfileTags,
} from "../../src/ingest/reconcile";
import { claimOf } from "../../src/ingest/review-check";
import { resolveIngestSettings } from "../../src/ingest/settings";
import {
  collectRepo,
  previewGithub,
  summarizeCompare,
  toPreviewItem,
} from "../../src/ingest/sources/github/collect";
import {
  createDefaultGhExec,
  createGhClient,
  GhError,
  parseJsonStream,
  sanitizeSecrets,
} from "../../src/ingest/sources/github/gh";
import {
  classifyPath,
  packContext,
  planCandidates,
} from "../../src/ingest/sources/github/highlights";
import { collectGithubMetrics, collectRepoMetrics } from "../../src/ingest/sources/github/metrics";
import { createIngestTools } from "../../src/ingest/tools";
import { seedFixture } from "../../src/testing/profile-fixtures";
import { fakeGh, LOGIN } from "../fixtures/github/fake-gh";

/** F03/M2 · lote de cobertura (teste depois): ramos alternativos reais dos módulos da ingestão. */

const NOW = new Date("2026-10-01T00:00:00Z");
function seeded(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  seedFixture(repos, "engineer");
  return repos;
}

describe("F03/M2 cobertura · reconcile", () => {
  it("formação: grau, status e datas em conflito; formação nova", () => {
    const f = existingFacts(seeded());
    const edu = (
      d: Partial<Extract<FactProposal, { kind: "education" }>["data"]>,
    ): FactProposal => ({
      kind: "education",
      confidence: 0.9,
      data: { institution: "UNICAMP", course: "ciência da computação", status: "completed", ...d },
    });
    const [r] = reconcileProposals(
      [
        {
          index: 0,
          proposal: edu({
            degree: "Mestrado",
            status: "in_progress",
            startDate: "2012",
            endDate: "2016",
          }),
        },
      ],
      f,
      NOW,
    );
    expect(r?.match).toBe("conflict");
    expect(r?.conflict?.fields.map((x) => x.field)).toEqual(
      expect.arrayContaining(["status", "startDate", "endDate"]),
    );
    expect(
      reconcileProposals([{ index: 0, proposal: edu({ institution: "MIT" }) }], f, NOW)[0]?.match,
    ).toBe("new");
  });

  it("experiência: fim e 'atual' divergentes; empresa desconhecida; conquista de experiência nova", () => {
    const f = existingFacts(seeded());
    const [r] = reconcileProposals(
      [
        {
          index: 0,
          proposal: {
            kind: "experience",
            confidence: 0.9,
            data: {
              company: "Beta Logística",
              title: "Engenheira de Software Pleno",
              startDate: "2020-06",
              endDate: "2022-12",
              isCurrent: true,
              tech: [],
            },
          },
        },
      ],
      f,
      NOW,
    );
    expect(r?.conflict?.fields.map((x) => x.field)).toEqual(["endDate", "isCurrent"]);
    const out = reconcileProposals(
      [
        {
          index: 0,
          proposal: {
            kind: "experience",
            confidence: 1,
            data: {
              company: "Nova SA",
              title: "Dev",
              startDate: "2001",
              isCurrent: false,
              tech: [],
            },
          },
        },
        {
          index: 1,
          proposal: { kind: "achievement", confidence: 1, data: { experienceIndex: 0, text: "x" } },
        },
        {
          index: 2,
          proposal: { kind: "achievement", confidence: 1, data: { experienceIndex: 9, text: "y" } },
        },
      ],
      f,
      NOW,
    );
    expect(out.map((x) => x.match)).toEqual(["new", "new", "new"]);
  });

  it("projeto por nome com datas em conflito; idioma igual; identidade e link sempre novos", () => {
    const f = existingFacts(seeded());
    const proj: FactProposal = {
      kind: "project",
      confidence: 1,
      data: { name: "Fila Leve", startDate: "2021-01", endDate: "2024-01", tech: [] },
    };
    expect(
      reconcileProposals([{ index: 0, proposal: proj }], f, NOW)[0]?.conflict?.fields.map(
        (x) => x.field,
      ),
    ).toEqual(["startDate", "endDate"]);
    const lang: FactProposal = {
      kind: "language",
      confidence: 1,
      data: { name: "Português", level: "native" },
    };
    expect(reconcileProposals([{ index: 0, proposal: lang }], f, NOW)[0]?.match).toBe("existing");
    expect(
      reconcileProposals(
        [{ index: 0, proposal: { kind: "identity", confidence: 1, data: { fullName: "Ana" } } }],
        f,
        NOW,
      )[0]?.match,
    ).toBe("new");
    expect(
      reconcileProposals(
        [
          {
            index: 0,
            proposal: {
              kind: "link",
              confidence: 1,
              data: { label: "site", url: "https://github.com/ana" },
            },
          },
        ],
        f,
        NOW,
      )[0]?.match,
    ).toBe("new");
  });

  it("normalizações e tags para conquista, formação, projeto e texto vazio", () => {
    expect(normalizeCompany("Ltda")).toBe("ltda");
    expect(canonicalSkill("Vue.js")).toBe(canonicalSkill("vuejs"));
    const profiles = [
      { id: "p", targetTitle: "Data Engineer", altTitles: ["Engenheira de Dados"], area: "dados" },
    ];
    expect(
      suggestProfileTags(
        {
          kind: "achievement",
          confidence: 1,
          data: { experienceIndex: 0, text: "Pipeline de dados" },
        },
        profiles,
      ),
    ).toEqual(["p"]);
    expect(
      suggestProfileTags(
        {
          kind: "education",
          confidence: 1,
          data: { institution: "X", course: "Engenharia de Dados", status: "completed" },
        },
        profiles,
      ),
    ).toEqual(["p"]);
    expect(
      suggestProfileTags(
        { kind: "project", confidence: 1, data: { name: "etl", description: "dados", tech: [] } },
        profiles,
      ),
    ).toEqual(["p"]);
    expect(suggestProfileTags({ kind: "identity", confidence: 1, data: {} }, profiles)).toEqual([]);
  });
});

describe("F03/M2 cobertura · review-check claimOf", () => {
  it("frase por tipo", () => {
    expect(
      claimOf({
        kind: "experience",
        confidence: 1,
        data: { company: "A", title: "B", startDate: "2020", isCurrent: true, tech: [] },
      }),
    ).toBe("experiência: B em A (2020–atual)");
    expect(
      claimOf({
        kind: "experience",
        confidence: 1,
        data: { company: "A", title: "B", startDate: "2020", isCurrent: false, tech: [] },
      }),
    ).toContain("2020–?");
    expect(
      claimOf({
        kind: "achievement",
        confidence: 1,
        data: { experienceIndex: 0, text: "T", metric: "M" },
      }),
    ).toBe("conquista: T (M)");
    expect(
      claimOf({
        kind: "education",
        confidence: 1,
        data: { institution: "I", course: "C", status: "completed" },
      }),
    ).toBe("formação: C em I");
    expect(
      claimOf({ kind: "language", confidence: 1, data: { name: "Inglês", level: "C1" } }),
    ).toBe("idioma: Inglês (C1)");
    expect(
      claimOf({ kind: "project", confidence: 1, data: { name: "P", description: "D", tech: [] } }),
    ).toBe("projeto: P — D");
    expect(
      claimOf({ kind: "link", confidence: 1, data: { label: "site", url: "https://x.y" } }),
    ).toBe("link: https://x.y");
    expect(claimOf({ kind: "identity", confidence: 1, data: { fullName: "Ana" } })).toContain(
      "identidade",
    );
  });
});

describe("F03/M2 cobertura · gh", () => {
  it("gh ausente vira 'unavailable' pelo executor real (sem rede: o binário não existe no container de testes)", async () => {
    const gh = createGhClient({
      exec: createDefaultGhExec({ token: "gho_x".padEnd(30, "x"), timeoutMs: 5_000 }),
    });
    const err = await gh.json("user").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GhError);
    expect(["unavailable", "not_authenticated", "failed"]).toContain((err as GhError).code);
  });

  it("falha genérica, exceção do exec, JSON incompleto, rate limit com retry explícito e /rate_limit indisponível", async () => {
    const generic = createGhClient({ exec: async () => ({ stdout: "", stderr: "", code: 2 }) });
    await expect(generic.json("x")).rejects.toMatchObject({ code: "failed" });
    const throwing = createGhClient({
      exec: async () => Promise.reject(new Error("boom gho_aaaaaaaaaaaaaaaaaaaaaaaa")),
    });
    const e = (await throwing.raw("x").catch((x: unknown) => x)) as GhError;
    expect(e.message).not.toContain("gho_aaaa");
    expect(() => parseJsonStream("[1,2")).toThrow(GhError);
    const explicit = createGhClient({
      exec: async () => ({
        stdout: "",
        stderr: "rate limit exceeded, retry after 30 (HTTP 429)",
        code: 1,
      }),
    });
    await expect(explicit.json("x")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSec: 30,
    });
    const noReset = createGhClient({
      exec: async (args) =>
        args[1] === "rate_limit"
          ? { stdout: "", stderr: "x", code: 1 }
          : { stdout: "", stderr: "API rate limit exceeded (HTTP 403)", code: 1 },
    });
    await expect(noReset.json("x")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSec: null,
    });
    const badReset = createGhClient({
      exec: async (args) =>
        args[1] === "rate_limit"
          ? { stdout: "{}", stderr: "", code: 0 }
          : { stdout: "", stderr: "API rate limit exceeded (HTTP 403)", code: 1 },
    });
    await expect(badReset.json("x")).rejects.toMatchObject({ retryAfterSec: null });
    const brokenReset = createGhClient({
      exec: async (args) =>
        args[1] === "rate_limit"
          ? { stdout: "não-json", stderr: "", code: 0 }
          : { stdout: "", stderr: "API rate limit exceeded (HTTP 403)", code: 1 },
    });
    await expect(brokenReset.json("x")).rejects.toMatchObject({ retryAfterSec: null });
    expect(sanitizeSecrets("token abc no meio", "abc")).toBe("token *** no meio");
  });

  it("tryJson/tryRaw repassam erros que não são 404; graphql sem dados", async () => {
    const auth = createGhClient({
      exec: async () => ({ stdout: "", stderr: "Bad credentials (HTTP 401)", code: 1 }),
    });
    await expect(auth.tryJson("x")).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(auth.tryRaw("x")).rejects.toMatchObject({ code: "not_authenticated" });
    const empty = createGhClient({
      exec: async () => ({ stdout: JSON.stringify({ data: null }), stderr: "", code: 0 }),
    });
    await expect(empty.graphql("query X { a }")).rejects.toMatchObject({ code: "failed" });
    const notPaged = createGhClient({
      exec: async () => ({ stdout: '{"a":1}', stderr: "", code: 0 }),
    });
    expect(await notPaged.json("x", { paginate: true })).toEqual([{ a: 1 }]);
  });
});

describe("F03/M2 cobertura · collect, metrics e highlights", () => {
  it("previewGithub repassa erro que não é de autenticação; repositório sem head; campos ausentes", async () => {
    const gh = createGhClient({
      exec: fakeGh({ user: { stdout: "", stderr: "Server Error (HTTP 500)", code: 1 } }).exec,
      sleep: async () => {},
    });
    // 5xx é transitório desde 2026-10-10: novas tentativas e, se persistir, "unavailable" (GitHub instável)
    await expect(previewGithub(gh, { mode: "public", login: LOGIN })).rejects.toMatchObject({
      code: "unavailable",
    });
    const noHead = createGhClient({
      exec: fakeGh({
        "repos/ana-exemplo/api-pagamentos/commits/main": {
          stdout: "",
          stderr: "gh: Not Found (HTTP 404)",
          code: 1,
        },
      }).exec,
    });
    const c = await collectRepo(noHead, "ana-exemplo/api-pagamentos", { login: LOGIN });
    expect(c.repo.headSha).toBeNull();
    expect(c.tree.entries).toEqual([]);
    expect(
      toPreviewItem({
        name: "x",
        full_name: "a/x",
        owner: { login: "a" },
        html_url: "https://github.com/a/x",
      } as never),
    ).toMatchObject({ description: null, language: null, stars: 0, pushedAt: null });
    await expect(collectRepo(noHead, "sem-barra", { login: LOGIN })).rejects.toThrow(/inválido/);
    expect(
      summarizeCompare(
        {
          base: "a",
          head: "b",
          aheadBy: 0,
          messages: [],
          files: [
            { path: "x", status: "added", additions: 1, deletions: 0, patch: "+".repeat(10) },
            { path: "y", status: "added", additions: 1, deletions: 0, patch: "+" },
          ],
        },
        { maxPatchChars: 10 },
      ),
    ).toContain("[patch truncado]");
  });

  it("métricas com campos nulos do GraphQL e id de usuário inválido; erro de autenticação não é engolido", async () => {
    const nulls = createGhClient({
      exec: async () => ({
        stdout: JSON.stringify({ data: { repository: null } }),
        stderr: "",
        code: 0,
      }),
    });
    expect(
      await collectRepoMetrics(nulls, { fullName: "a/b", login: "a", userId: "U" }),
    ).toMatchObject({ commits: 0, prsOpened: 0 });
    await expect(
      collectRepoMetrics(nulls, { fullName: "a/b", login: "a", userId: "x y" }),
    ).rejects.toThrow(/inválido/);
    let call = 0;
    const authFails = createGhClient({
      exec: async () => {
        call++;
        if (call === 1) {
          return {
            stdout: JSON.stringify({
              data: {
                user: {
                  id: "U",
                  contributionsCollection: { contributionYears: [] },
                  ownRepos: { totalCount: 0 },
                  contributedTo: { totalCount: 0 },
                },
              },
            }),
            stderr: "",
            code: 0,
          };
        }
        return { stdout: "", stderr: "Bad credentials (HTTP 401)", code: 1 };
      },
    });
    await expect(
      collectGithubMetrics(authFails, { login: "a", repos: ["a/b"] }),
    ).rejects.toMatchObject({ code: "not_authenticated" });
    const yearsNull = createGhClient({
      exec: async (args) => {
        const q = args.find((a) => a.startsWith("query=")) ?? "";
        if (q.includes("UserMetrics")) {
          return {
            stdout: JSON.stringify({
              data: {
                user: {
                  id: "U",
                  contributionsCollection: { contributionYears: [2020] },
                  ownRepos: { totalCount: 1 },
                  contributedTo: { totalCount: 0 },
                },
              },
            }),
            stderr: "",
            code: 0,
          };
        }
        return { stdout: JSON.stringify({ data: { y2020: null } }), stderr: "", code: 0 };
      },
    });
    const out = await collectGithubMetrics(yearsNull, { login: "a", repos: [] });
    expect(out.years[0]?.metrics.commits).toBe(0);
  });

  it("classificação de variantes e contexto sem README, com amostra de arquivo cortado na origem", () => {
    expect(classifyPath("src/app.min.js")).toBeNull();
    expect(classifyPath("Dockerfile.prod")).toBe("manifest");
    expect(classifyPath("api/Api.csproj")).toBe("manifest");
    expect(classifyPath("tests/test_api.py")).toBe("test");
    expect(classifyPath("notes.txt")).toBeNull();
    expect(planCandidates([{ path: "big.ts", size: 300_000 }])).toEqual([]);
    const ctx = packContext({
      repo: {
        fullName: "a/b",
        description: null,
        languages: {},
        topics: [],
        stars: 0,
        pushedAt: null,
        isFork: true,
      },
      readme: null,
      commitMessages: ["x"],
      metricsTable: null,
      files: [{ path: "src/x.ts", content: "abc", truncated: true }],
      sliceTokens: 2_000,
      maxCharsPerFile: 100,
    });
    expect(ctx.text).toContain("(sem descrição)");
    expect(ctx.truncated).toEqual(["src/x.ts"]);
  });
});

describe("F03/M2 cobertura · tools, notificações e settings", () => {
  it("digest de repositório, limite da lista, run inexistente e arquivo sem digest", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    repos.users.ensureId();
    const repo = repos.repos.upsert({
      fullName: "ana/api",
      owner: "ana",
      url: "https://github.com/ana/api",
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
    repos.repoDigests.upsert({
      repoId: repo.id,
      summary: "API",
      keyPoints: [],
      sections: [],
      meta: {},
      editedByUser: false,
    });
    const text = repos.sourceFiles.insert({
      mime: "text/plain",
      size: 1,
      sha256: "t",
      path: "p",
      kind: "text",
    });
    const tools = createIngestTools(repos, { dataDir: "/tmp" });
    expect(tools["file.get_digest"]({ repoId: repo.id }).digest?.subjectKind).toBe("repo");
    expect(tools["file.get_digest"]({ fileId: text.id }).digest).toBeNull();
    expect(tools["file.get_digest"]({ repoId: text.id }).digest).toBeNull();
    expect(tools["file.list"]({ limit: 1 }).items).toHaveLength(1);
    expect(tools["file.list"]({}).items.find((i) => i.id === text.id)?.name).toBe("Texto livre");
    expect(() => tools["file.get_text"]({ fileId: text.id, from: 0, to: 5 })).toThrow(IngestError);
    expect(() => tools["ingest.status"]({ runId: repo.id })).toThrow(IngestError);
  });

  it("rótulos das notificações para GitHub, texto e currículo sem nome; singular", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    repos.users.ensureId();
    const gh = repos.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/b"] },
      budget: {
        amount: 1000,
        unit: "thousand",
        depth: "quick",
        perRepo: 500,
        reserve: { synthesis: 100, check: 0 },
      },
    });
    repos.ingestionRuns.setStatus(gh.id, "review");
    repos.proposals.insertMany(gh.id, [
      { kind: "skill", confidence: 1, data: { name: "Go", category: "language" } },
    ]);
    expect(
      syncRunNotifications(repos, gh.id).map((e) => [e.notification.title, e.notification.body]),
    ).toContainEqual(["Pronta para revisão: GitHub (1 repositório)", "1 proposta para revisar"]);
    const gh2 = repos.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: {},
      budget: {
        amount: 1000,
        unit: "thousand",
        depth: "quick",
        perRepo: 500,
        reserve: { synthesis: 100, check: 0 },
      },
    });
    repos.ingestionRuns.setStatus(gh2.id, "awaiting_decision");
    expect(syncRunNotifications(repos, gh2.id)[0]?.notification.title).toBe(
      "Orçamento esgotado: GitHub (0 repositórios)",
    );
    for (const kind of ["text", "cv"] as const) {
      const f = repos.sourceFiles.insert({
        mime: "text/plain",
        size: 1,
        sha256: `s-${kind}`,
        path: "p",
        kind,
      });
      const run = repos.ingestionRuns.create({
        fileId: f.id,
        provider: "mock",
        models: { document: "h", facts: "h", digest: "s" },
        options: { ocr: false, modelRead: false },
      });
      repos.ingestionRuns.setStatus(run.id, "done");
      expect(syncRunNotifications(repos, run.id)[0]?.notification.title).toBe(
        `Ingestão concluída: ${kind === "text" ? "Texto livre" : "Currículo"}`,
      );
    }
  });

  it("settings: valor escalar sobrescreve, objeto mescla com o padrão", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    repos.settings.set("ingest.auto_confirm_below", 0);
    repos.settings.set("budget.default", { quick: 1 });
    const s = resolveIngestSettings(repos.settings);
    expect(s.autoConfirmBelow).toBe(0);
    expect(s.budgetDefaults).toEqual({ quick: 1, balanced: 50_000, deep: 150_000 });
  });
});
