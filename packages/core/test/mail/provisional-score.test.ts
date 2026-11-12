import { describe, expect, it } from "vitest";
import {
  createRepos,
  intakePostingFromMail,
  migrate,
  openDatabase,
  provisionalMatchScore,
  refreshProvisionalScores,
  runScheduledTask,
} from "../../src";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F14-16 (decisão do dono 2026-11-11) · score provisório das vagas do e-mail sem descrição: só pelo cargo, senioridade
 * e local do alerta, contra os perfis; marcado como provisório, trocado pelo completo e fora da pré-análise automática.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  seedFixture(repos, "engineer"); // Senior Backend Engineer (e "Engenheira de Software Sênior"), sênior, só remoto
  const make = (title: string, location: string | null = "Remoto") =>
    intakePostingFromMail(repos, {
      title,
      company: `Empresa ${title} ${location ?? ""}`,
      location,
      url: null,
      gmailId: "g",
      platform: "linkedin",
      trusted: true,
    }).posting;
  return { repos, make };
}

describe("F14-16 · score provisório pelo alerta", () => {
  it("ordena pelo cargo e pela senioridade do perfil; local fora do que o perfil aceita pesa contra", () => {
    const { repos, make } = setup();
    const s = (title: string, location?: string | null) =>
      provisionalMatchScore(repos, make(title, location)) as number;
    const backend = s("Senior Backend Engineer");
    const generic = s("Desenvolvedor de Software Sênior"); // de software, sem especialidade (o perfil é backend)
    const fullstack = s("Desenvolvedor Full Stack Sênior");
    const junior = s("Desenvolvedor Backend Júnior");
    const intern = s("Estágio TI");
    const pm = s("Senior Project Manager");
    const onsite = s("Senior Backend Engineer", "Recife, PE (Presencial)");
    expect(backend).toBeGreaterThanOrEqual(85);
    expect(generic).toBeLessThan(backend);
    expect(generic).toBeGreaterThan(junior);
    expect(fullstack).toBeGreaterThan(junior);
    expect(junior).toBeGreaterThan(intern);
    expect(pm).toBeLessThan(40);
    expect(intern).toBeLessThan(30);
    expect(onsite).toBeLessThan(backend);
  });

  it("gravado como provisório; o completo toma o lugar e não volta a ser provisório", () => {
    const { repos, make } = setup();
    const p = make("Senior Backend Engineer");
    expect(refreshProvisionalScores(repos)).toBeGreaterThan(0);
    expect(repos.postings.get(p.id)).toMatchObject({ matchScoreProvisional: true });
    expect(repos.postings.get(p.id)?.matchScore).toBeGreaterThan(0);
    repos.postings.setMatchScore(p.id, 40);
    refreshProvisionalScores(repos);
    expect(repos.postings.get(p.id)).toMatchObject({
      matchScore: 40,
      matchScoreProvisional: false,
    });
  });

  it("provisório alto nunca pede a pré-análise automática", async () => {
    const { repos, make } = setup();
    const p = make("Senior Backend Engineer");
    repos.postings.setStatus(p.id, "ready");
    repos.postings.setProvisionalScore(p.id, 99);
    await runScheduledTask({
      repos,
      dataDir: "/tmp",
      taskId: "postings.auto_analyze",
      trigger: "manual",
      now: new Date("2026-11-11T12:00:00.000Z"),
      publish: async () => {},
    });
    expect(repos.postings.get(p.id)?.autoAnalysisAt).toBeNull();
  });

  it("sem perfil: sem score", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const { posting } = intakePostingFromMail(repos, {
      title: "Senior Backend Engineer",
      company: "Acme",
      location: null,
      url: null,
      gmailId: "g",
      platform: null,
    });
    expect(provisionalMatchScore(repos, posting)).toBeNull();
  });
});
