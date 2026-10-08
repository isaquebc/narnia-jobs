import { AnalyzeProfilesInputSchema } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { buildAnalyzeInput, estimateAnalyze } from "../../src/profile/analyze-input";
import { seedFixture } from "../../src/testing/profile-fixtures";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  return { r, ids };
}

describe("F02/M2 profile/analyze-input · entrada compacta e estimativa (§2.6, §2.9-7)", () => {
  it("monta a entrada válida no schema com todo o histórico, perfis existentes e títulos dispensados", () => {
    const { r } = setup();
    r.suggestions.create({
      source: "heuristic",
      payload: {
        title: "Head of Platform",
        seniority: "manager",
        area: "software",
        market: "BR",
        rationale: "x",
        supportingFactIds: [],
      },
    });
    r.suggestions.dismiss(r.suggestions.list()[0]?.id as string);
    const input = buildAnalyzeInput(r);
    expect(AnalyzeProfilesInputSchema.safeParse(input).success).toBe(true);
    expect(input.identity.name).toBe("Ana Maria Exemplo");
    expect(input.experiences).toHaveLength(6);
    expect(input.experiences[0]?.achievements.length).toBeGreaterThan(0);
    expect(input.experiences[0]?.period).toMatch(/\d{4}/);
    expect(input.projects).toHaveLength(2);
    expect(input.education).toHaveLength(2);
    expect(input.skills).toHaveLength(20);
    expect(input.languages).toHaveLength(2);
    expect(input.existingProfiles).toEqual([
      {
        name: "Eng. Software Sênior",
        targetTitle: "Senior Backend Engineer",
        seniority: "senior",
        area: "software",
      },
    ]);
    expect(input.dismissedTitles).toEqual(["head of platform"]);
  });

  it("exclui itens ocultos em qualquer perfil (e as conquistas da experiência oculta), sem duplicar fatos", () => {
    const { r, ids } = setup();
    const pm = r.profiles.create({
      name: "PM",
      targetTitle: "Project Manager",
      altTitles: [],
      seniority: "senior",
      area: "produto",
      goal: "career_change",
      market: "BR",
      docLocale: "pt-BR",
      needsResearch: ["salary", "contractTypes", "locations", "availableFrom"],
      userId: ids.userId,
      isActive: false,
    });
    r.emphasis.replace(pm.id, [
      { kind: "experience", id: ids.experienceIds[5] as string, mode: "hidden" },
      { kind: "skill", id: ids.skillIds[18] as string, mode: "hidden" },
    ]);
    const input = buildAnalyzeInput(r);
    expect(input.experiences).toHaveLength(5);
    expect(input.experiences.map((e) => e.id)).not.toContain(ids.experienceIds[5]);
    expect(input.skills.map((s) => s.id)).not.toContain(ids.skillIds[18]);
    const allIds = [...input.experiences, ...input.skills, ...input.projects].map((x) => x.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("inclui o resumo dos digests dos arquivos enviados", () => {
    const { r } = setup();
    const file = r.sourceFiles.insert({
      originalName: "cv.pdf",
      mime: "application/pdf",
      size: 10,
      sha256: "a".repeat(64),
      path: "uploads/a.pdf",
      kind: "cv",
    });
    r.digests.upsert({
      fileId: file.id,
      summary: "Currículo com foco em pagamentos.",
      keyPoints: [],
      sections: [],
      meta: {},
      editedByUser: false,
    });
    const input = buildAnalyzeInput(r);
    expect(input.digests).toEqual([
      { fileName: "cv.pdf", summary: "Currículo com foco em pagamentos." },
    ]);
  });

  it("estimativa cresce com o volume e usa o modelo informado", () => {
    const { r } = setup();
    const input = buildAnalyzeInput(r);
    const small = estimateAnalyze({ ...input, experiences: [] }, "sonnet");
    const full = estimateAnalyze(input, "sonnet");
    expect(full.tokens).toBeGreaterThan(small.tokens);
    expect(full.model).toBe("sonnet");
    expect(full.tokens).toBeGreaterThan(800);
  });
});
