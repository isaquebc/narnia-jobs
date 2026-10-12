import { describe, expect, it } from "vitest";
import { type ChatIngestPort, createChatTools } from "../../src/chat/tools";
import { createRepos, domainMatches, migrate, openDatabase, toFtsQuery } from "../../src/db";
import { rebuildCard } from "../../src/profile/cards";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** F04/M1 · cobertura (teste depois: cobertura) dos ramos das tools e dos repositórios do chat. */
const noIngest: ChatIngestPort = {
  startText: async () => ({
    runId: "r",
    status: "queued",
    estimatedTokens: 0,
    needsConfirmation: false,
    alreadyRead: false,
  }),
  startFile: async () => ({
    runId: "r",
    status: "queued",
    estimatedTokens: 0,
    needsConfirmation: false,
    alreadyRead: false,
  }),
  startGithub: async () => ({
    runId: "r",
    status: "estimating",
    estimatedTokens: 0,
    needsConfirmation: true,
  }),
};

function seeded() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  rebuildCard(repos, ids.profileId);
  const file = repos.sourceFiles.insert({
    originalName: null,
    mime: "text/plain",
    size: 5,
    sha256: "b".repeat(64),
    path: "uploads/b.txt",
    kind: "text",
  });
  repos.digests.upsert({
    fileId: file.id,
    summary: "Relato de carreira em pagamentos",
    keyPoints: ["x"],
    sections: [],
    meta: {},
    editedByUser: false,
    textPath: null,
  });
  const bare = repos.sourceFiles.insert({
    originalName: "vazio.pdf",
    mime: "application/pdf",
    size: 5,
    sha256: "c".repeat(64),
    path: "uploads/c.pdf",
    kind: "cv",
  });
  const repo = repos.repos.upsert({
    fullName: "ana/cobranca",
    owner: "ana",
    url: "https://github.com/ana/cobranca",
    description: null,
    isPrivate: true,
    isFork: false,
    isArchived: false,
    languages: {},
    topics: [],
    stars: 0,
    pushedAt: null,
    defaultBranch: "main",
    headSha: null,
    relevance: 0,
  });
  repos.repoDigests.upsert({
    repoId: repo.id,
    summary: "Cobrança recorrente",
    keyPoints: [],
    sections: [],
    meta: {},
    editedByUser: false,
  });
  const repoNoDigest = repos.repos.upsert({
    fullName: "ana/sem-resumo",
    owner: "ana",
    url: "https://github.com/ana/sem-resumo",
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
    relevance: 0,
  });
  return { repos, ids, file, bare, repo, repoNoDigest };
}

describe("F04/M1 cobertura · tools", () => {
  it("fact.get e fact.search cobrem todos os tipos, inclusive arquivo e repositório com e sem resumo", async () => {
    const { repos, ids, file, bare, repo, repoNoDigest } = seeded();
    const t = createChatTools(repos, { ingest: noIngest });
    const refs = [
      { kind: "achievement" as const, id: ids.achievementIds[0] as string },
      { kind: "project" as const, id: ids.projectIds[0] as string },
      { kind: "skill" as const, id: ids.skillIds[0] as string },
      { kind: "language" as const, id: ids.languageIds[0] as string },
      { kind: "file" as const, id: file.id },
      { kind: "file" as const, id: bare.id },
      { kind: "repo" as const, id: repo.id },
      { kind: "repo" as const, id: repoNoDigest.id },
    ];
    const g = await t["fact.get"]({ refs });
    expect(g.items).toHaveLength(refs.length);
    for (const kind of [
      "achievement",
      "project",
      "skill",
      "education",
      "language",
      "file",
      "repo",
    ] as const)
      await expect(t["fact.get"]({ refs: [{ kind, id: "nao" }] })).rejects.toMatchObject({
        code: "fact_not_found",
      });
    const s = await t["fact.search"]({
      q: "pagamentos",
      kinds: ["file", "achievement", "experience"],
    });
    expect(s.items.some((i) => i.kind === "file")).toBe(true);
    expect((await t["fact.search"]({ q: "cobranca", kinds: ["repo"] })).items[0]?.kind).toBe(
      "repo",
    );
    const from = await t["fact.search"]({ q: "acme", from: "2000" });
    expect(from.items.length).toBeGreaterThan(0);
    // experiência atual se sobrepõe a qualquer período futuro: só ela sobra
    const future = await t["fact.search"]({ q: "acme", from: "2999" });
    expect(future.items.every((i) => i.period?.endsWith("atual"))).toBe(true);
    expect((await t["fact.timeline"]({ from: "2000" })).items).toBeDefined();
    expect((await t["evidence.project.get"]({ id: ids.projectIds[0] as string })).kind).toBe(
      "project",
    );
    const u = await t["fact.unverified"]({ limit: 1 });
    expect(u.nextCursor).toBeNull();
    await expect(t["fact.verify"]({ kind: "skill", id: "nao" })).rejects.toMatchObject({
      code: "fact_not_found",
    });
  });

  it("sem perfil ativo nem sessão: listas sem relevância, pesquisa sem perfil, sessão ausente", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    repos.users.ensureId();
    repos.facts.skills.insert({
      name: "Go",
      category: "language",
      level: 4,
      confidence: 1,
      verified: true,
    });
    const t = createChatTools(repos, { ingest: noIngest, sessionId: "nao-existe" });
    const l = await t["evidence.skill.list"]({});
    expect(l.items[0]?.relevance).toBeNull();
    expect(l.items[0]?.line).toMatch(/nível 4/);
    const r = await t["research.save"]({
      url: "https://www.ibge.gov.br/a",
      title: "t",
      excerpt: "e",
      usedFor: "x",
    });
    expect(repos.researchSources.get(r.id)?.profileId).toBeNull();
    expect((await t["research.list"]({})).items).toHaveLength(1);
    await expect(t["session.set_category"]({ category: "career" })).rejects.toMatchObject({
      code: "no_session",
    });
    expect((await t["fact.search"]({ q: "go" })).items[0]?.relevance).toBeNull();
    expect(await t["ingest.file"]).toBeDefined();
  });

  it("ingest.file com arquivo existente chega à porta e devolve o link", async () => {
    const { repos, bare } = seeded();
    const r = await createChatTools(repos, { ingest: noIngest })["ingest.file"]({
      fileId: bare.id,
    });
    expect(r.url).toBe("/ingestao/r");
  });
});

describe("F04/M1 cobertura · repositórios do chat", () => {
  it("sessões: filtros, setters, uso, atividade e contagem de vivas", () => {
    const { repos, ids } = seeded();
    const a = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "A",
      provider: "mock",
      model: "sonnet",
    });
    const b = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "clarify",
      title: "B",
      provider: "mock",
      model: "haiku",
      ingestionRunId: null,
    });
    repos.chatSessions.setState(b.id, "archived");
    repos.chatSessions.setModel(a.id, "opus");
    repos.chatSessions.setTitle(a.id, "Carreira");
    repos.chatSessions.setProviderSessionId(a.id, "ps");
    repos.chatSessions.setCardHash(a.id, "h1");
    repos.chatSessions.addUsage(a.id, { inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    repos.chatSessions.addUsage(a.id, { inputTokens: 1, outputTokens: 1 });
    repos.chatSessions.touch(a.id);
    const got = repos.chatSessions.get(a.id);
    expect(got).toMatchObject({
      model: "opus",
      title: "Carreira",
      providerSessionId: "ps",
      cardHash: "h1",
      tokensIn: 11,
    });
    expect(repos.chatSessions.list({ profileId: ids.profileId }).map((s) => s.id)).toEqual([a.id]);
    expect(repos.chatSessions.list({ includeArchived: true })).toHaveLength(2);
    expect(repos.chatSessions.list({ states: ["archived"] }).map((s) => s.id)).toEqual([b.id]);
    expect(repos.chatSessions.countLive()).toBe(1);
    expect(repos.chatSessions.get("nao")).toBeNull();
  });

  it("mensagens: ordem, paginação para trás e próximo turno", () => {
    const { repos, ids } = seeded();
    const s = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "A",
      provider: "mock",
      model: "sonnet",
    });
    expect(repos.chatMessages.nextTurnIndex(s.id)).toBe(0);
    const m: string[] = [];
    for (let i = 0; i < 4; i++)
      m.push(
        repos.chatMessages.add({
          sessionId: s.id,
          turnIndex: i,
          role: i % 2 ? "assistant" : "user",
          contentMd: `m${i}`,
          toolCalls:
            i === 1 ? [{ name: "fact.search", args: "{}", durationMs: 3, isError: false }] : [],
          usage: i === 1 ? { inputTokens: 1, outputTokens: 2 } : null,
        }).id,
      );
    expect(repos.chatMessages.list(s.id, { limit: 2 }).map((x) => x.contentMd)).toEqual([
      "m2",
      "m3",
    ]);
    expect(
      repos.chatMessages.list(s.id, { limit: 2, before: m[2] as string }).map((x) => x.contentMd),
    ).toEqual(["m0", "m1"]);
    expect(repos.chatMessages.list(s.id)[1]?.toolCalls).toHaveLength(1);
    expect(repos.chatMessages.nextTurnIndex(s.id)).toBe(4);
  });

  it("domínios: máscaras, duplicata, remoção e padrão só desligável; fontes aceitas", () => {
    const { repos } = seeded();
    expect(domainMatches("*.gov.br", "www.dados.gov.br")).toBe(true);
    expect(domainMatches("*.gov.br", "gov.br")).toBe(false);
    expect(domainMatches("glassdoor.*", "glassdoor.com.br")).toBe(true);
    expect(domainMatches("glassdoor.*", "glassdoor")).toBe(false);
    expect(domainMatches("levels.fyi", "www.levels.fyi")).toBe(true);
    expect(domainMatches("levels.fyi", "app.levels.fyi")).toBe(true);
    expect(domainMatches("levels.fyi", "notlevels.fyi")).toBe(false);
    const d = repos.trustedDomains.add({ pattern: " Exemplo.COM ", trustTag: "other" });
    expect(d.pattern).toBe("exemplo.com");
    expect(() => repos.trustedDomains.add({ pattern: "exemplo.com", trustTag: "other" })).toThrow(
      /já cadastrado/,
    );
    expect(() => repos.trustedDomains.remove("td-ibge")).toThrow(/padrão/);
    expect(() => repos.trustedDomains.remove("nao")).toThrow(/não encontrado/);
    repos.trustedDomains.remove(d.id);
    repos.trustedDomains.setEnabled("td-levels", false);
    expect(repos.trustedDomains.match("levels.fyi")).toBeNull();
    repos.trustedDomains.restoreDefaults();
    expect(repos.trustedDomains.match("levels.fyi")?.trustTag).toBe("survey");
    const src = repos.researchSources.add({
      profileId: null,
      sessionId: null,
      url: "https://levels.fyi/x",
      domain: "levels.fyi",
      title: "t",
      excerpt: "e",
      usedFor: "salary",
      trustTag: "survey",
    });
    repos.researchSources.setAccepted(src.id, true);
    expect(repos.researchSources.get(src.id)?.accepted).toBe(true);
    repos.researchSources.setAccepted(src.id, false);
    expect(repos.researchSources.list().find((s) => s.id === src.id)?.accepted).toBe(false);
    expect(repos.researchSources.get("nao")).toBeNull();
  });

  it("busca: texto sem palavras não consulta; operadores do usuário são neutralizados", () => {
    const { repos } = seeded();
    expect(toFtsQuery("  ;; ")).toBeNull();
    expect(toFtsQuery('acme AND "go')).toBe('"acme"* "AND"* "go"*');
    expect(repos.factSearch.search("--")).toEqual([]);
    expect(repos.factSearch.search("acme", { kinds: ["experience"], limit: 1 })).toHaveLength(1);
  });
});

describe("F04/M1 cobertura · fatos com dados parciais", () => {
  it("projeto sem datas nem papel, conquista sem métrica, formação em andamento e período com dia", async () => {
    const { repos, ids } = seeded();
    const exp = ids.experienceIds[0] as string;
    const p = repos.facts.projects.insert({
      name: "Ferramenta Ornitorrinco",
      tech: [],
      confidence: 1,
      verified: false,
    });
    const p2 = repos.facts.projects.insert({
      name: "Painel Ornitorrinco",
      role: "autora",
      startDate: "2021-03",
      endDate: "2021-09",
      tech: ["ts"],
      confidence: 1,
      verified: true,
    });
    const a = repos.facts.achievements.insert({
      experienceId: exp,
      text: "Migrou Ornitorrinco",
      confidence: 1,
      verified: false,
    });
    const e = repos.facts.education.insert({
      institution: "Escola Ornitorrinco",
      course: "Dados",
      status: "in_progress",
      confidence: 1,
      verified: false,
    });
    const t = createChatTools(repos, { ingest: noIngest });
    const all = await t["fact.search"]({ q: "ornitorrinco" });
    expect(all.items.map((i) => i.id).sort()).toEqual([p.id, p2.id, a.id, e.id].sort());
    const dated = await t["fact.search"]({
      q: "ornitorrinco",
      from: "2021-05-10",
      to: "2021-06-01",
    });
    expect(dated.items.map((i) => i.id)).toContain(p2.id);
    expect(dated.items.map((i) => i.id)).not.toContain(p.id);
    const projects = await t["evidence.project.list"]({ limit: 50 });
    expect(projects.items.find((i) => i.id === p.id)?.line).toBe("Ferramenta Ornitorrinco");
    expect(projects.items.find((i) => i.id === p2.id)?.line).toMatch(/autora · 2021-03–2021-09/);
    expect(
      (await t["fact.get"]({ refs: [{ kind: "achievement", id: a.id }] })).items[0]?.detail.text,
    ).toBe("Migrou Ornitorrinco");
    const edu = await t["evidence.education.list"]({ limit: 50 });
    expect(edu.items.find((i) => i.id === e.id)?.line).toBe("Escola Ornitorrinco · Dados");
    repos.facts.experiences.remove(exp);
    const orphan = await t["fact.search"]({ q: "ornitorrinco", kinds: ["achievement"] });
    expect(orphan.items).toHaveLength(0);
  });
});
