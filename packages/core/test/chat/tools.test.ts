import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChatIngestPort, ChatToolError, createChatTools } from "../../src/chat/tools";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { rebuildCard } from "../../src/profile/cards";
import { type SeededIds, seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F04/M1 · handlers das tools do chat. Dados montados pelo caminho de produção: `seedFixture` (repositórios),
 * relevância pela reconstrução real do cartão (`rebuildCard`), jobs pelo repositório. A ingestão pela conversa
 * usa uma porta registradora: o caminho real (rotas do api) é ligado no M2 (F04-16).
 */
let repos: Repos;
let ids: SeededIds;
let calls: Array<{ op: string; arg: unknown }>;

function port(o: { githubConfirm?: boolean } = {}): ChatIngestPort {
  return {
    async startText(text) {
      calls.push({ op: "text", arg: text.length });
      return {
        runId: "run-t",
        status: "queued",
        estimatedTokens: 4_000,
        needsConfirmation: false,
        alreadyRead: false,
      };
    },
    async startFile(fileId) {
      calls.push({ op: "file", arg: fileId });
      return {
        runId: "run-f",
        status: "queued",
        estimatedTokens: 7_000,
        needsConfirmation: false,
        alreadyRead: true,
      };
    },
    async proposeChange(plan) {
      calls.push({ op: "change", arg: plan.change.factId });
      return { runId: "run-c", status: "review" };
    },
    async confirm(runId) {
      calls.push({ op: "confirm", arg: runId });
      return { runId, status: "queued" };
    },
    async startGithub(req) {
      calls.push({ op: "github", arg: req });
      return {
        runId: "run-g",
        status: "estimating",
        estimatedTokens: 20_000,
        needsConfirmation: o.githubConfirm ?? true,
      };
    },
  };
}

beforeEach(() => {
  const db = openDatabase(":memory:");
  migrate(db);
  repos = createRepos(db);
  ids = seedFixture(repos, "engineer");
  rebuildCard(repos, ids.profileId);
  calls = [];
});
afterEach(() => repos.db.close());

const tools = (extra: Partial<Parameters<typeof createChatTools>[1]> = {}) =>
  createChatTools(repos, { ingest: port(), ...extra });

describe("F04/M1 core · evidence.*", () => {
  it("lista experiências em uma linha cada, pela relevância do perfil, com paginação", async () => {
    const t = tools();
    const p1 = await t["evidence.experience.list"]({ limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.items[0]?.line).toMatch(/ · .+ · \d{4}/);
    const scores = p1.items.map((i) => i.relevance ?? 0);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1] as number);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await t["evidence.experience.list"]({ limit: 2, cursor: p1.nextCursor as string });
    expect(p2.items.map((i) => i.id)).not.toContain(p1.items[0]?.id);
    const all = await t["evidence.experience.list"]({ limit: 50 });
    expect(all.items).toHaveLength(ids.experienceIds.length);
    expect(all.nextCursor).toBeNull();
  });

  it("get traz o detalhe com conquistas; id inexistente é erro tipado", async () => {
    const t = tools();
    const d = await t["evidence.experience.get"]({ id: ids.experienceIds[0] as string });
    expect(d.kind).toBe("experience");
    expect(Array.isArray(d.detail.achievements)).toBe(true);
    await expect(t["evidence.experience.get"]({ id: "nao-existe" })).rejects.toMatchObject({
      code: "fact_not_found",
    });
  });

  it("skills, projetos e formação também em uma linha", async () => {
    const t = tools();
    expect((await t["evidence.skill.list"]({ limit: 50 })).items).toHaveLength(ids.skillIds.length);
    expect((await t["evidence.project.list"]({})).items).toHaveLength(ids.projectIds.length);
    const edu = await t["evidence.education.list"]({});
    expect(edu.items.some((i) => /Computação/.test(i.line))).toBe(true);
  });
});

describe("F04/M1 core · fact.*", () => {
  it("search ignora acento, aceita prefixo, filtra por tipo e devolve linhas compactas", async () => {
    const t = tools();
    const r = await t["fact.search"]({ q: "computacao" });
    expect(r.items.some((i) => i.kind === "education")).toBe(true);
    const only = await t["fact.search"]({ q: "acme", kinds: ["experience"] });
    expect(only.items.length).toBeGreaterThan(0);
    expect(only.items.every((i) => i.kind === "experience")).toBe(true);
    for (const i of r.items) expect(i.line.length).toBeLessThanOrEqual(200);
    expect(await t["fact.search"]({ q: '"; drop table' })).toEqual({ items: [], total: 0 });
  });

  it("search filtra por período (fatos sem data ficam de fora quando há período)", async () => {
    const t = tools();
    const all = await t["fact.search"]({ q: "acme" });
    const old = await t["fact.search"]({ q: "acme", to: "1990" });
    expect(all.items.length).toBeGreaterThan(0);
    expect(old.items).toHaveLength(0);
  });

  it("get devolve detalhe de vários tipos; timeline lista o que se sobrepõe ao período", async () => {
    const t = tools();
    const g = await t["fact.get"]({
      refs: [
        { kind: "experience", id: ids.experienceIds[0] as string },
        { kind: "education", id: ids.educationIds[0] as string },
      ],
    });
    expect(g.items.map((i) => i.kind)).toEqual(["experience", "education"]);
    const tl = await t["fact.timeline"]({ from: "2000", to: "2100" });
    expect(tl.items.filter((i) => i.kind === "experience")).toHaveLength(ids.experienceIds.length);
    expect((await t["fact.timeline"]({ from: "1900", to: "1901" })).items).toHaveLength(0);
  });

  it("unverified lista o que falta confirmar; verify marca e incrementa a versão dos fatos", async () => {
    const t = tools();
    const s = repos.facts.skills.insert({
      name: "Elixir",
      category: "language",
      confidence: 0.6,
      verified: false,
    });
    const u = await t["fact.unverified"]({});
    expect(u.items.map((i) => i.id)).toContain(s.id);
    const v0 = repos.settings.getFactsVersion();
    expect(await t["fact.verify"]({ kind: "skill", id: s.id })).toEqual({ ok: true });
    expect(repos.facts.skills.get(s.id)?.verified).toBe(true);
    expect(repos.settings.getFactsVersion()).toBeGreaterThan(v0);
    expect((await t["fact.unverified"]({})).items.map((i) => i.id)).not.toContain(s.id);
  });
});

describe("F04/M1 core · research.*", () => {
  it("save normaliza a URL, casa a máscara e recusa domínio fora da lista", async () => {
    const t = tools();
    const r = await t["research.save"]({
      url: "https://WWW.IBGE.gov.br/estatisticas?utm_source=x&id=7#topo",
      title: "Rendimento médio",
      excerpt: "R$ 12.000",
      usedFor: "salary",
    });
    expect(r.domain).toBe("ibge.gov.br");
    expect(r.trustTag).toBe("official");
    const saved = repos.researchSources.get(r.id);
    expect(saved?.url).toBe("https://www.ibge.gov.br/estatisticas?id=7");
    expect(saved?.profileId).toBe(ids.profileId);
    await expect(
      t["research.save"]({
        url: "https://blog.exemplo.com/x",
        title: "x",
        excerpt: "y",
        usedFor: "salary",
      }),
    ).rejects.toMatchObject({ code: "untrusted_domain" });
    const list = await t["research.list"]({});
    expect(list.items[0]?.line).toMatch(/ibge\.gov\.br/);
  });

  it("sem a exigência de lista confiável, fonte fora da lista é salva como other", async () => {
    repos.settings.set("research.require_trusted", false);
    const r = await tools()["research.save"]({
      url: "https://blog.exemplo.com/x",
      title: "x",
      excerpt: "y",
      usedFor: "salary",
    });
    expect(r.trustTag).toBe("other");
  });
});

describe("F04/M1 core · job.*, session.* e usage.log", () => {
  it("job.status e job.list sobre o espelho de jobs", async () => {
    repos.jobs.upsertQueued({
      id: "task__ingest.github.prepare__r1",
      queue: "ingest",
      type: "ingest.github.prepare",
      parentId: null,
      profileId: null,
      payload: { kind: "task", type: "ingest.github.prepare", key: "r1", payload: { runId: "r1" } },
      stage: "ingest.github.prepare",
      at: new Date().toISOString(),
    });
    const t = tools();
    const s = await t["job.status"]({ jobId: "task__ingest.github.prepare__r1" });
    expect(s).toMatchObject({ status: "queued", progress: 0 });
    expect((await t["job.list"]({})).items[0]?.line).toMatch(/ingest\.github\.prepare · queued/);
    await expect(t["job.status"]({ jobId: "x" })).rejects.toMatchObject({ code: "job_not_found" });
  });

  it("session.get exige sessão; set_category troca a categoria", async () => {
    await expect(tools()["session.get"]({})).rejects.toMatchObject({ code: "no_session" });
    const s = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Conversa",
      provider: "mock",
      model: "sonnet",
    });
    const t = tools({ sessionId: s.id });
    expect((await t["session.get"]({})).category).toBe("career");
    expect(await t["session.set_category"]({ category: "ingest" })).toEqual({ ok: true });
    expect(repos.chatSessions.get(s.id)?.category).toBe("ingest");
  });

  it("usage.log conta cada turno uma vez (dedupe com o registro do modo A)", async () => {
    const t = tools();
    const u = {
      providerSessionId: "ps1",
      turnIndex: 0,
      model: "sonnet",
      inputTokens: 100,
      outputTokens: 20,
    };
    expect(await t["usage.log"](u)).toEqual({ recorded: true });
    expect(await t["usage.log"](u)).toEqual({ recorded: false });
    expect(repos.usageEvents.list(10).filter((e) => e.origin === "claude-log")).toHaveLength(1);
  });
});

describe("F04/M1 core · ingest.text/file/github pela conversa", () => {
  it("texto cria execução pela porta e não grava fatos; devolve o link da execução", async () => {
    const before = repos.facts.counts();
    const r = await tools()["ingest.text"]({
      text: "Trabalhei como engenheira na Acme. ".repeat(10),
    });
    expect(r).toMatchObject({ runId: "run-t", url: "/ingestao/run-t", needsConfirmation: false });
    expect(calls).toEqual([{ op: "text", arg: expect.any(Number) }]);
    expect(repos.facts.counts()).toEqual(before);
  });

  it("arquivo inexistente é recusado antes de chegar à porta", async () => {
    await expect(tools()["ingest.file"]({ fileId: "nao-existe" })).rejects.toMatchObject({
      code: "file_not_found",
    });
    expect(calls).toHaveLength(0);
  });

  it("GitHub sempre pede confirmação, mesmo se a porta disser o contrário (F03-13)", async () => {
    const t = createChatTools(repos, { ingest: port({ githubConfirm: false }) });
    const r = await t["ingest.github"]({ mode: "private", repos: ["ana/api"], depth: "quick" });
    expect(r.needsConfirmation).toBe(true);
    expect(r.url).toBe("/ingestao/run-g");
  });

  it("entrada inválida é recusada pelo schema", async () => {
    await expect(tools()["ingest.text"]({ text: "curto" })).rejects.toThrow();
    expect(ChatToolError).toBeDefined();
  });
});

describe("R5 · id curto para citar", () => {
  const ref = (id: string) => id.replace(/-/g, "").slice(-6);

  it("busca, listas e detalhes devolvem o ref do fato (as conquistas da experiência também)", async () => {
    const t = tools();
    const acme = ids.experienceIds[0] as string;
    const s = await t["fact.search"]({ q: "acme", kinds: ["experience"] });
    expect(s.items[0]).toMatchObject({ id: acme, ref: `f:${ref(acme)}` });
    const list = await t["evidence.skill.list"]({ limit: 1 });
    expect(list.items[0]?.ref).toBe(`f:${ref(list.items[0]?.id as string)}`);
    const d = await t["evidence.experience.get"]({ id: acme });
    expect(d.ref).toBe(`f:${ref(acme)}`);
    const ach = (d.detail.achievements as Array<{ id: string; ref: string }>)[0];
    expect(ach?.ref).toBe(`f:${ref(ach?.id as string)}`);
    const g = await t["fact.get"]({ refs: [{ kind: "skill", id: ids.skillIds[0] as string }] });
    expect(g.items[0]?.ref).toBe(`f:${ref(ids.skillIds[0] as string)}`);
  });

  it("pesquisa salva e listada devolve o ref r:", async () => {
    const t = tools();
    const r = await t["research.save"]({
      url: "https://www.ibge.gov.br/x",
      title: "Rendimento",
      excerpt: "R$ 12.000",
      usedFor: "salary",
    });
    expect(r.ref).toBe(`r:${ref(r.id)}`);
    expect((await t["research.list"]({})).items[0]?.ref).toBe(`r:${ref(r.id)}`);
  });
});
