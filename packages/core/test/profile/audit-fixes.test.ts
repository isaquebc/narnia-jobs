import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { enqueueTask, type TaskJobData } from "../../src/jobs/tasks";
import { buildProfileCard, type CardUser } from "../../src/profile/card";
import { rebuildCard, validProfileIds } from "../../src/profile/cards";
import { collectFactSets, scoreFacts } from "../../src/profile/relevance";
import { refreshHeuristicSuggestions } from "../../src/profile/suggest";
import { buildObjectiveSummary, type SummaryExperience } from "../../src/profile/summary";
import { seedFixture } from "../../src/testing/profile-fixtures";

const NOW = new Date("2026-10-08T12:00:00Z");

function setup(name: "engineer" | "leader" = "engineer") {
  const db = openDatabase(":memory:");
  migrate(db);
  const r: Repos = createRepos(db);
  const ids = seedFixture(r, name);
  return { r, ids };
}

const PM = {
  name: "Project Manager",
  targetTitle: "Project Manager",
  altTitles: [],
  seniority: "senior" as const,
  area: "produto",
  goal: "career_change" as const,
  market: "BR",
  docLocale: "pt-BR",
  needsResearch: ["salary", "contractTypes", "locations", "availableFrom"] as Array<
    "salary" | "contractTypes" | "locations" | "availableFrom"
  >,
};

describe("Auditoria F02 (2026-10-08) · correções em TDD", () => {
  it("1. enqueueTask após espelho em erro remove o job falho da fila e enfileira de novo", async () => {
    const { r } = setup();
    const calls: string[] = [];
    const failedHandle = {
      getState: async () => "failed",
      remove: async () => {
        calls.push("remove");
      },
      retry: async () => {
        calls.push("retry");
      },
    };
    const q = {
      add: async (_n: string, _d: TaskJobData, _o: { jobId: string }) => {
        calls.push("add");
      },
      getJob: async (_id: string) => failedHandle,
    };
    const queues = { ingest: q, ocr: q, extract: q };
    const input = {
      queues,
      repos: r,
      queue: "extract" as const,
      type: "profile.analyze",
      key: "u",
    };
    await enqueueTask(input);
    r.jobs.applyEvent({
      jobId: "task__profile.analyze__u",
      type: "failed",
      at: "2026-10-08T12:00:00.000Z",
      error: "provider",
    });
    expect(r.jobs.get("task__profile.analyze__u")?.status).toBe("error");
    const again = await enqueueTask(input);
    expect(again.enqueued).toBe(true);
    expect(again.job.status).toBe("queued");
    // o job falho (mesmo id) sai da BullMQ antes do add, senão o add é ignorado
    expect(calls).toEqual(["add", "remove", "add"]);
  });

  it("2. nível e título atuais vêm da experiência atual, não da de início mais recente", () => {
    const exps: SummaryExperience[] = [
      {
        company: "Firma",
        title: "Engenheiro de Software Sênior",
        startDate: "2015-03",
        isCurrent: true,
      },
      {
        company: "Bico",
        title: "Desenvolvedor Júnior",
        startDate: "2021-01",
        endDate: "2021-06",
        isCurrent: false,
      },
    ];
    const lines = buildObjectiveSummary({ experiences: exps }, NOW);
    expect(lines[2]).toMatch(/Nível atual: s[eê]nior/i);
    expect(lines[2]).not.toMatch(/Júnior/);
  });

  it("3. emphasis.replace com kinds preserva as ênfases dos tipos não enviados", () => {
    const { r, ids } = setup();
    const ach = r.facts.achievements.list()[0];
    const exp = r.facts.experiences.list()[0];
    expect(ach && exp).toBeTruthy();
    r.emphasis.replace(ids.profileId, [
      { kind: "achievement", id: (ach as { id: string }).id, mode: "hidden" },
      { kind: "experience", id: (exp as { id: string }).id, mode: "highlight" },
    ]);
    r.emphasis.replace(
      ids.profileId,
      [{ kind: "experience", id: (exp as { id: string }).id, mode: "normal" }],
      { kinds: ["experience", "project", "skill", "education", "language"] },
    );
    const after = r.emphasis.list(ids.profileId);
    expect(after.find((e) => e.factKind === "achievement")?.mode).toBe("hidden");
    expect(after.find((e) => e.factKind === "experience")?.mode).toBe("normal");
  });

  it("4. pitch gigante: cartão respeita o teto sem cortar linha no meio; identidade e alvo presentes", () => {
    const { r, ids } = setup();
    const profile = {
      ...(r.profiles.get(ids.profileId) as NonNullable<ReturnType<Repos["profiles"]["get"]>>),
      pitch: "x".repeat(2000),
    };
    const user = r.users.get() as CardUser;
    const facts = collectFactSets(r);
    const emphasis = r.emphasis.list(ids.profileId);
    const relevance = scoreFacts(profile, facts, emphasis, NOW);
    const card = buildProfileCard(user, profile, facts, emphasis, relevance, NOW);
    expect(card.text.length).toBeLessThanOrEqual(1600);
    const lines = card.text.split("\n");
    expect(lines[0]).toMatch(/Ana Maria Exemplo/);
    expect(card.text).toMatch(/\nAlvo: /);
    expect(card.text).toMatch(/\nCarreira: /);
    // nenhuma linha é um fragmento: a linha do pitch termina com reticências e nada é cortado no meio
    const pitch = lines.find((l) => l.startsWith("Pitch: ")) as string;
    expect(pitch.endsWith("…")).toBe(true);
    expect(lines.every((l) => l.length <= 400)).toBe(true);
  });

  it("5. renomear ou mudar a persona não invalida o cartão; mudar o pitch invalida", () => {
    const { r, ids } = setup();
    rebuildCard(r, ids.profileId, NOW);
    expect(r.profiles.get(ids.profileId)?.cardUpdatedAt).not.toBeNull();
    r.profiles.update(ids.profileId, { name: "Outro nome" });
    expect(r.profiles.get(ids.profileId)?.cardUpdatedAt).not.toBeNull();
    r.profiles.updatePersonaOverrides(ids.profileId, { tone: "cordial" });
    expect(r.profiles.get(ids.profileId)?.cardUpdatedAt).not.toBeNull();
    r.profiles.update(ids.profileId, { pitch: "novo pitch" });
    expect(r.profiles.get(ids.profileId)?.cardUpdatedAt).toBeNull();
  });

  it("6. validProfileIds exclui perfis arquivados", () => {
    const { r, ids } = setup();
    const pm = r.profiles.create({ ...PM, userId: r.users.ensureId(), isActive: false });
    rebuildCard(r, ids.profileId, NOW);
    rebuildCard(r, pm.id, NOW);
    expect(validProfileIds(r).sort()).toEqual([ids.profileId, pm.id].sort());
    r.profiles.archive(pm.id);
    rebuildCard(r, pm.id, NOW);
    expect(validProfileIds(r)).toEqual([ids.profileId]);
  });

  it("7. refreshHeuristicSuggestions só recalcula quando facts_version mudou", () => {
    const { r } = setup("leader");
    let runs = 0;
    const original = r.suggestions.dismissedTitles.bind(r.suggestions);
    r.suggestions.dismissedTitles = () => {
      runs += 1;
      return original();
    };
    const first = refreshHeuristicSuggestions(r, NOW);
    expect(first.length).toBeGreaterThan(0);
    expect(runs).toBe(1);
    // sem escrita de fato: a heurística não roda nem grava
    expect(refreshHeuristicSuggestions(r, NOW)).toEqual([]);
    expect(runs).toBe(1);
    // escrita de fato (bump de facts_version): roda de novo
    r.facts.skills.insert({ name: "Kubernetes", category: "tool", confidence: 1, verified: true });
    refreshHeuristicSuggestions(r, NOW);
    expect(runs).toBe(2);
  });
});
