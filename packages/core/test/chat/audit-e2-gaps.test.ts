import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChatIngestPort, createChatTools } from "../../src/chat/tools";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { type SeededIds, seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Auditoria pós-F04 · bloco E2 (18a) · `fact.gaps`: o que a extração não preencheu (datas, métricas, nível, resumo,
 * pesquisa pendente). A entrevista de descoberta pergunta só isso (02-fluxos, passo 7). Fatos pelos repositórios.
 */
let repos: Repos;
let ids: SeededIds;
const port: ChatIngestPort = {
  proposeChange: async () => {
    throw new Error("não usado");
  },
  startText: async () => {
    throw new Error("não usado");
  },
  startFile: async () => {
    throw new Error("não usado");
  },
  startGithub: async () => {
    throw new Error("não usado");
  },
  confirm: async () => {
    throw new Error("não usado");
  },
};
const meta = { confidence: 0.8, verified: false };

beforeEach(() => {
  const db = openDatabase(":memory:");
  migrate(db);
  repos = createRepos(db);
  ids = seedFixture(repos, "engineer");
});
afterEach(() => repos.db.close());

describe("auditoria E2 · fact.gaps", () => {
  it("lista as lacunas por fato, com o que falta em cada um, e deixa de fora o que está completo", async () => {
    const open = repos.facts.experiences.insert({
      company: "Zeta Labs",
      title: "Consultora",
      startDate: "2016-03",
      isCurrent: false,
      tech: [],
      ...meta,
    });
    repos.facts.achievements.insert({
      experienceId: open.id,
      text: "Melhorei o onboarding",
      ...meta,
    });
    const complete = repos.facts.experiences.insert({
      company: "Omega Bank",
      title: "Tech Lead",
      startDate: "2014-01",
      endDate: "2016-02",
      isCurrent: false,
      summary: "Liderou o time de pagamentos.",
      tech: ["Go"],
      ...meta,
    });
    repos.facts.achievements.insert({
      experienceId: complete.id,
      text: "Reduzi a latência",
      metric: "-40%",
      ...meta,
    });
    const skill = repos.facts.skills.insert({ name: "Terraform", category: "infra", ...meta });
    const edu = repos.facts.education.insert({
      institution: "USP",
      course: "MBA",
      status: "completed",
      ...meta,
    });
    repos.profiles.update(ids.profileId, { needsResearch: ["salary"] });

    const t = createChatTools(repos, { ingest: port });
    const all: Array<{ kind: string; id: string; line: string; missing: string[] }> = [];
    let cursor: string | undefined;
    do {
      const p = await t["fact.gaps"]({ limit: 50, ...(cursor ? { cursor } : {}) });
      all.push(...p.items);
      cursor = p.nextCursor ?? undefined;
    } while (cursor);
    const of = (id: string) => all.find((g) => g.id === id);

    expect(of(open.id)).toMatchObject({ kind: "experience", missing: ["data de fim", "resumo"] });
    expect(of(open.id)?.line).toContain("Zeta Labs");
    expect(
      all.find((g) => g.kind === "achievement" && g.line.includes("onboarding"))?.missing,
    ).toEqual(["métrica"]);
    expect(of(complete.id)).toBeUndefined();
    expect(
      all.find((g) => g.kind === "achievement" && g.line.includes("latência")),
    ).toBeUndefined();
    expect(of(skill.id)).toMatchObject({ kind: "skill", missing: ["nível"] });
    expect(of(edu.id)).toMatchObject({ kind: "education", missing: ["datas"] });
    expect(of(ids.profileId)).toMatchObject({ kind: "profile", missing: ["salary"] });
  });

  it("paginação com limit/cursor como as outras listas", async () => {
    const t = createChatTools(repos, { ingest: port });
    for (let i = 0; i < 3; i++)
      repos.facts.skills.insert({ name: `Skill ${i}`, category: "tool", ...meta });
    const p1 = await t["fact.gaps"]({ limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBe("2");
  });
});
