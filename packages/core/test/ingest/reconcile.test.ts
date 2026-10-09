import type { FactProposal } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import {
  applyReconciliation,
  canonicalSkill,
  existingFacts,
  normalizeCompany,
  reconcileProposals,
  suggestProfileTags,
} from "../../src/ingest/reconcile";
import { seedFixture } from "../../src/testing/profile-fixtures";

function setup(): { repos: Repos; ids: ReturnType<typeof seedFixture> } {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  return { repos, ids: seedFixture(repos, "engineer") };
}

const exp = (
  data: Partial<Extract<FactProposal, { kind: "experience" }>["data"]>,
): FactProposal => ({
  kind: "experience",
  confidence: 0.9,
  data: {
    company: "Acme Pagamentos Ltda.",
    title: "Engenheira de Software Sênior",
    startDate: "2023-02",
    isCurrent: true,
    tech: [],
    ...data,
  },
});
const NOW = new Date("2026-10-01T00:00:00Z");

describe("F03/M2 reconcile: novo, existente, conflito (F03 §2.8)", () => {
  it("normalização de empresa (caixa, acento, sufixo societário) e sinônimos de skill", () => {
    expect(normalizeCompany("ACME Pagamentos Ltda.")).toBe(normalizeCompany("acme pagamentos"));
    expect(normalizeCompany("Épsilon Startups S.A.")).toBe("epsilon startups");
    expect(canonicalSkill("ReactJS")).toBe(canonicalSkill("React"));
    expect(canonicalSkill("NodeJS")).toBe(canonicalSkill("Node.js"));
    expect(canonicalSkill("Postgres")).toBe(canonicalSkill("PostgreSQL"));
    expect(canonicalSkill("k8s")).toBe(canonicalSkill("Kubernetes"));
  });

  it("experiência da mesma empresa normalizada com datas sobrepostas e mesmos campos → existing", () => {
    const { repos, ids } = setup();
    const [r] = reconcileProposals([{ index: 0, proposal: exp({}) }], existingFacts(repos), NOW);
    expect(r).toMatchObject({ match: "existing", targetId: ids.experienceIds[0], conflict: null });
  });

  it("campo divergente → conflict com valor atual e novo, campo a campo", () => {
    const { repos, ids } = setup();
    const [r] = reconcileProposals(
      [{ index: 0, proposal: exp({ title: "Staff Engineer", startDate: "2023-05" }) }],
      existingFacts(repos),
      NOW,
    );
    expect(r?.match).toBe("conflict");
    expect(r?.targetId).toBe(ids.experienceIds[0]);
    expect(r?.conflict?.targetId).toBe(ids.experienceIds[0]);
    expect(r?.conflict?.fields.map((f) => [f.field, f.current, f.proposed])).toEqual([
      ["title", "Engenheira de Software Sênior", "Staff Engineer"],
      ["startDate", "2023-02", "2023-05"],
    ]);
  });

  it("precisão diferente de data (2023 × 2023-02) não é conflito; sobreposição < 50% é outra experiência", () => {
    const { repos } = setup();
    const f = existingFacts(repos);
    expect(
      reconcileProposals([{ index: 0, proposal: exp({ startDate: "2023" }) }], f, NOW)[0]?.match,
    ).toBe("existing");
    const other = exp({ startDate: "2010-01", endDate: "2011-01", isCurrent: false });
    expect(reconcileProposals([{ index: 0, proposal: other }], f, NOW)[0]?.match).toBe("new");
  });

  it("skill por sinônimo vira existing; skill desconhecida é new", () => {
    const { repos } = setup();
    const f = existingFacts(repos);
    const skill = (name: string): FactProposal => ({
      kind: "skill",
      confidence: 0.8,
      data: { name, category: "framework" },
    });
    expect(reconcileProposals([{ index: 0, proposal: skill("ReactJS") }], f, NOW)[0]?.match).toBe(
      "existing",
    );
    expect(reconcileProposals([{ index: 0, proposal: skill("Elixir") }], f, NOW)[0]?.match).toBe(
      "new",
    );
  });

  it("projeto pelo url (sem barra final ou .git) ou pelo nome; idioma com nível diferente é conflito", () => {
    const { repos, ids } = setup();
    const f = existingFacts(repos);
    const proj: FactProposal = {
      kind: "project",
      confidence: 0.9,
      data: { name: "outro-nome", url: "https://example.com/ana/narnia-jobs/", tech: [] },
    };
    expect(reconcileProposals([{ index: 0, proposal: proj }], f, NOW)[0]).toMatchObject({
      match: "existing",
      targetId: ids.projectIds[0],
    });
    const lang: FactProposal = {
      kind: "language",
      confidence: 0.9,
      data: { name: "inglês", level: "B2" },
    };
    expect(reconcileProposals([{ index: 0, proposal: lang }], f, NOW)[0]?.match).toBe("conflict");
  });

  it("conquista de experiência existente: mesmo texto → existing; texto novo → new", () => {
    const { repos } = setup();
    const f = existingFacts(repos);
    const ach = (text: string): FactProposal => ({
      kind: "achievement",
      confidence: 0.8,
      data: { experienceIndex: 0, text },
    });
    const out = reconcileProposals(
      [
        { index: 0, proposal: exp({}) },
        { index: 1, proposal: ach("Reduziu a latência p95 do checkout") },
        { index: 2, proposal: ach("Criou o time de plataforma") },
      ],
      f,
      NOW,
    );
    expect(out.map((r) => r.match)).toEqual(["existing", "existing", "new"]);
  });

  it("só compara com fatos: proposta igual a uma rejeitada antes (não virou fato) segue new", () => {
    const { repos } = setup();
    const f = existingFacts(repos);
    const novo = exp({
      company: "Ômega Fintech",
      startDate: "2012-01",
      endDate: "2013-01",
      isCurrent: false,
    });
    expect(reconcileProposals([{ index: 0, proposal: novo }], f, NOW)[0]?.match).toBe("new");
  });

  it("tags por perfil: sugere o perfil cujo alvo aparece no fato; nunca automático", () => {
    const profiles = [
      { id: "p1", targetTitle: "Senior Backend Engineer", altTitles: [], area: "software" },
      { id: "p2", targetTitle: "Product Manager", altTitles: [], area: "produto" },
    ];
    expect(suggestProfileTags(exp({ title: "Backend Engineer" }), profiles)).toEqual(["p1"]);
    expect(
      suggestProfileTags(
        {
          kind: "skill",
          confidence: 1,
          data: { name: "Roadmap de produto", category: "management" },
        },
        profiles,
      ),
    ).toEqual(["p2"]);
    expect(
      suggestProfileTags(
        { kind: "language", confidence: 1, data: { name: "Inglês", level: "C1" } },
        profiles,
      ),
    ).toEqual([]);
  });

  it("applyReconciliation grava match, conflito e tags nas propostas pendentes do run", () => {
    const { repos, ids } = setup();
    const file = repos.sourceFiles.insert({
      mime: "text/plain",
      size: 1,
      sha256: "s1",
      path: "p",
      kind: "cv",
    });
    const run = repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    repos.proposals.insertMany(run.id, [
      exp({ title: "Staff Engineer" }),
      { kind: "skill", confidence: 0.8, data: { name: "Elixir", category: "language" } },
    ]);
    const counts = applyReconciliation(repos, run.id, NOW);
    expect(counts).toEqual({ new: 1, existing: 0, conflict: 1 });
    const [p0, p1] = repos.proposals.listByRun(run.id);
    expect(p0).toMatchObject({ match: "conflict", matchTargetId: ids.experienceIds[0] });
    expect(p0?.conflict?.fields[0]).toMatchObject({ currentSource: null, proposedSource: "cv" });
    expect(p0?.suggestedProfiles).toEqual([ids.profileId]);
    expect(p1?.match).toBe("new");
  });
});
