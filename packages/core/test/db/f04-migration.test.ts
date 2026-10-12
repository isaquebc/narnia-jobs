import { describe, expect, it } from "vitest";
import { resolveChatSettings } from "../../src/chat/settings";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F04/M1 · migration 0004_chat. O banco real do dono passa por ela no próximo reinício do api: o upgrade parte de um
 * banco 0001–0003 populado pelos repositórios de produção (lição da F03 §8), nunca por SQL à mão.
 */
function f03Database() {
  const db = openDatabase(":memory:");
  expect(migrate(db, { until: "0003_ingest" }).applied).toEqual([
    "0001_init",
    "0002_profiles",
    "0003_ingest",
  ]);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  const file = repos.sourceFiles.insert({
    originalName: "cv.pdf",
    mime: "application/pdf",
    size: 10,
    sha256: "a".repeat(64),
    path: "uploads/a.pdf",
    kind: "cv",
  });
  repos.digests.upsert({
    fileId: file.id,
    summary: "Currículo com liderança técnica em pagamentos",
    keyPoints: ["Acme"],
    sections: [],
    meta: {},
    editedByUser: false,
    textPath: null,
  });
  const repo = repos.repos.upsert({
    fullName: "ana/api",
    owner: "ana",
    url: "https://github.com/ana/api",
    description: "API",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    languages: { TypeScript: 100 },
    topics: ["api"],
    stars: 2,
    pushedAt: "2026-10-01T00:00:00.000Z",
    defaultBranch: "main",
    headSha: "aaa",
    relevance: 0.5,
  });
  repos.repoDigests.upsert({
    repoId: repo.id,
    summary: "Serviço de cobrança recorrente em Kubernetes",
    keyPoints: ["filas"],
    sections: [],
    meta: {},
    editedByUser: false,
  });
  repos.notifications.upsert({
    kind: "review.pending",
    subjectKind: "ingestion_run",
    subjectId: "r1",
    title: "Pronta para revisão",
    actionUrl: "/ingestao/r1",
  });
  return { db, ids, file, repo };
}

const count = (db: ReturnType<typeof openDatabase>, sql: string) =>
  Number((db.prepare(sql).get() as { n: number }).n);

describe("F04/M1 migration 0004_chat", () => {
  it("upgrade de um banco 0003 preserva tudo, carrega o índice com os dados existentes e passa no foreign_key_check", () => {
    const { db, ids } = f03Database();
    const before = {
      exp: count(db, "select count(*) n from experience"),
      skills: count(db, "select count(*) n from skill"),
      notif: count(db, "select count(*) n from notification"),
      profiles: count(db, "select count(*) n from profile"),
    };
    expect(migrate(db).applied).toEqual(["0004_chat"]);
    expect(count(db, "select count(*) n from experience")).toBe(before.exp);
    expect(count(db, "select count(*) n from skill")).toBe(before.skills);
    expect(count(db, "select count(*) n from notification")).toBe(before.notif);
    expect(count(db, "select count(*) n from profile")).toBe(before.profiles);
    const facts =
      ids.experienceIds.length +
      ids.achievementIds.length +
      ids.projectIds.length +
      ids.skillIds.length +
      ids.educationIds.length +
      ids.languageIds.length;
    expect(count(db, "select count(*) n from fact_fts")).toBe(facts + 2); // + digest do arquivo + do repositório
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
    for (const t of ["chat_session", "chat_message", "research_source", "trusted_domain"])
      expect(
        count(db, `select count(*) n from sqlite_master where type = 'table' and name = '${t}'`),
      ).toBe(1);
    const cols = (
      db.prepare("pragma table_info(usage_event)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["provider_session_id", "turn_index"]));
  });

  it("busca ignora acento e aceita prefixo, inclusive nos resumos de arquivo e repositório", () => {
    const { db } = f03Database();
    migrate(db);
    const kinds = (q: string) =>
      (
        db
          .prepare("select kind from fact_fts where fact_fts match ? order by kind")
          .all(q) as Array<{
          kind: string;
        }>
      ).map((r) => r.kind);
    expect(kinds("computacao*")).toContain("education");
    expect(kinds("kubernet*")).toContain("repo");
    expect(kinds("lideranca")).toContain("file");
  });

  it("gatilhos mantêm o índice em insert, update e delete de cada tabela de fato e de digests", () => {
    const { db, ids, file, repo } = f03Database();
    migrate(db);
    const repos = createRepos(db);
    const hits = (q: string) =>
      count(db, `select count(*) n from fact_fts where fact_fts match '${q}'`);
    const skill = repos.facts.skills.insert({
      name: "Zigbee",
      category: "other",
      confidence: 1,
      verified: false,
    });
    expect(hits("zigbee")).toBe(1);
    repos.facts.skills.update(skill.id, { name: "Quokka" });
    expect(hits("zigbee")).toBe(0);
    expect(hits("quokka")).toBe(1);
    repos.facts.skills.remove(skill.id);
    expect(hits("quokka")).toBe(0);
    const exp = ids.experienceIds[0] as string;
    repos.facts.experiences.update(exp, { title: "Arquiteta Xylofone" });
    expect(hits("xylofone")).toBe(1);
    const ach = repos.facts.achievements.insert({
      experienceId: exp,
      text: "Reduziu custos com Wombat",
      confidence: 1,
      verified: false,
    });
    expect(hits("wombat")).toBe(1);
    repos.facts.achievements.remove(ach.id);
    expect(hits("wombat")).toBe(0);
    for (const [table, kind] of [
      ["project", "project"],
      ["education", "education"],
      ["language", "language"],
    ] as const)
      expect(count(db, `select count(*) n from fact_fts where kind = '${kind}'`)).toBe(
        count(db, `select count(*) n from ${table}`),
      );
    repos.digests.upsert({
      fileId: file.id,
      summary: "Resumo novo com Capivara",
      keyPoints: [],
      sections: [],
      meta: {},
      editedByUser: false,
      textPath: null,
    });
    expect(hits("capivara")).toBe(1);
    expect(hits("lideranca")).toBe(0);
    repos.repoDigests.upsert({
      repoId: repo.id,
      summary: "Agora com Tamandua",
      keyPoints: [],
      sections: [],
      meta: {},
      editedByUser: false,
    });
    expect(hits("tamandua")).toBe(1);
  });

  it("semeia os domínios confiáveis padrão e as configurações do chat têm os padrões decididos", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const domains = repos.trustedDomains.list().map((d) => d.pattern);
    expect(domains).toEqual(expect.arrayContaining(["*.gov.br", "ibge.gov.br"]));
    expect(repos.trustedDomains.list().every((d) => d.builtin && d.enabled)).toBe(true);
    expect(resolveChatSettings(repos.settings)).toEqual({
      maxLiveSessions: 5,
      hibernateAfterMin: 60,
      maxTurns: 8,
      defaultModel: "sonnet",
      maxBudgetUsd: null,
      requireTrustedResearch: true,
    });
  });
});
