import { describe, expect, it } from "vitest";
import {
  createRepos,
  discardedPostings,
  intakePostingFromMail,
  migrate,
  openDatabase,
  runScheduledTask,
} from "../../src";

/**
 * F14/M4 · tarefas do feed: pré-análise automática acima do corte, só das prontas e sem análise, até o teto do dia
 * (F14-6, F14-7); arquivamento por 30 dias sem interação, sem candidatura, fora da calibração do fit (F14-9).
 */
const T = new Date("2026-11-11T12:00:00.000Z");
const DAY = 86_400_000;

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const make = (
    title: string,
    score: number | null,
    status: "ready" | "extracting" = "ready",
    trusted = true,
  ) => {
    const { posting } = intakePostingFromMail(repos, {
      title,
      company: "Acme",
      location: null,
      url: null,
      gmailId: "g",
      platform: null,
      trusted,
    });
    repos.postings.setMatchScore(posting.id, score);
    repos.postings.setStatus(posting.id, status);
    return posting.id;
  };
  const run = (taskId: "postings.auto_analyze" | "postings.feed_archive", now = T) =>
    runScheduledTask({
      repos,
      dataDir: "/tmp",
      taskId,
      trigger: "manual",
      now,
      publish: async () => {},
    });
  return { repos, make, run };
}

describe("F14/M4 · pré-análise automática", () => {
  it("marca as prontas acima do corte (70), sem as que ainda extraem, até o teto do dia", async () => {
    const { repos, make, run } = setup();
    const alta = make("Alta", 90);
    const corte = make("No corte", 70);
    make("Baixa", 69);
    make("Sem score", null);
    make("Extraindo", 95, "extracting");
    const desconhecido = make("Remetente desconhecido", 99, "ready", false);
    repos.settings.set("mail.preanalysisDailyCap", 1);
    await run("postings.auto_analyze");
    expect([alta, corte].filter((id) => repos.postings.get(id)?.autoAnalysisAt)).toEqual([alta]);
    await run("postings.auto_analyze", new Date(T.getTime() + 60_000));
    expect(repos.postings.get(corte)?.autoAnalysisAt).toBeNull();
    await run("postings.auto_analyze", new Date(T.getTime() + DAY));
    expect(repos.postings.get(corte)?.autoAnalysisAt).not.toBeNull();
    // revisão do M4: e-mail de remetente que não é confiável nunca abre o agente sozinho
    expect(repos.postings.get(desconhecido)?.autoAnalysisAt).toBeNull();
  });

  it("revisão do M4: o teto conta as pedidas hoje mesmo que tenham saído do feed (arquivadas)", async () => {
    const { repos, make, run } = setup();
    const a = make("A", 90);
    const b = make("B", 90);
    repos.settings.set("mail.preanalysisDailyCap", 1);
    await run("postings.auto_analyze");
    const marked = [a, b].find((id) => repos.postings.get(id)?.autoAnalysisAt) as string;
    repos.postings.setArchived(marked, { reason: "salary", note: null });
    await run("postings.auto_analyze", new Date(T.getTime() + 60_000));
    expect([a, b].filter((id) => repos.postings.get(id)?.autoAnalysisAt)).toHaveLength(1);
  });
});

describe("F14/M4 · arquivamento do feed", () => {
  it("30 dias sem interação: arquiva com archive_auto, sem motivo da pessoa, e fica fora do fit", async () => {
    const { repos, make, run } = setup();
    const velha = make("Velha", 50);
    const tocada = make("Tocada", 50);
    repos.db
      .prepare("update posting set created_at = ? where id in (?, ?)")
      .run(new Date(T.getTime() - 40 * DAY).toISOString(), velha, tocada);
    repos.postings.touchInteraction(tocada, new Date(T.getTime() - 5 * DAY).toISOString());
    const r = await run("postings.feed_archive");
    expect(repos.scheduled.run(r.id)?.counts).toEqual({ archived: 1 });
    expect(repos.postings.get(velha)).toMatchObject({ archiveAuto: "stale", archiveReason: null });
    expect(repos.postings.get(velha)?.archivedAt).not.toBeNull();
    expect(repos.postings.get(tocada)?.archivedAt).toBeNull();
    expect(repos.postings.feed().map((p) => p.id)).toEqual([tocada]);
    expect(discardedPostings(repos, "outra").map((d) => d.id)).not.toContain(velha);
  });

  it("desarquivar pela pessoa limpa o automático", () => {
    const { repos, make } = setup();
    const id = make("X", 50);
    repos.postings.setArchiveAuto(id, "stale");
    repos.postings.setArchived(id, null);
    expect(repos.postings.get(id)).toMatchObject({ archiveAuto: null, archivedAt: null });
  });
});
