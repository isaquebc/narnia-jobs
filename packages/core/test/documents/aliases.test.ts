import type { CoverLetterDraft, CvDraft } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { aliasBriefIds } from "../../src/documents/aliases";
import { buildCvBrief } from "../../src/documents/brief";
import { seedFixture } from "../../src/testing/profile-fixtures";

function brief() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  return buildCvBrief(r, {
    kind: "cv",
    profileId: ids.profileId,
    postingId: null,
    locale: "pt-BR",
    instructions: null,
    previousIssues: [],
  }).brief;
}

/**
 * IDs curtos para o gerador: os UUIDv7 dos fatos são longos e quase iguais (mesmo prefixo de tempo), e o modelo chegou
 * a misturar dois deles numa origem. O gerador recebe e1, a3, s12…; o código traduz a resposta de volta.
 */
describe("F05 core · IDs curtos no resumo do gerador", () => {
  it("cada fato ganha um id curto pelo tipo; o resto do resumo fica igual", () => {
    const b = brief();
    const { brief: short } = aliasBriefIds(b);
    expect(short.experiences.map((e) => e.id)).toEqual(b.experiences.map((_, i) => `e${i + 1}`));
    expect(short.experiences[0]?.achievements[0]?.id).toBe("a1");
    expect(short.skills.every((s) => /^s\d+$/.test(s.id))).toBe(true);
    expect(short.education.every((s) => /^ed\d+$/.test(s.id))).toBe(true);
    expect(short.projects.every((s) => /^p\d+$/.test(s.id))).toBe(true);
    expect(short.experiences[0]?.title).toBe(b.experiences[0]?.title);
    expect(JSON.stringify(short)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    const prev = aliasBriefIds({
      ...b,
      previousIssues: [
        {
          area: "facts",
          message: `A experiência ${b.experiences[1]?.id} não existe.`,
          where: null,
        },
      ],
    }).brief.previousIssues;
    expect(prev[0]?.message).toBe("A experiência e2 não existe.");
  });

  it("a resposta volta com os ids reais; id curto desconhecido fica como veio (a montagem aponta)", () => {
    const b = brief();
    const { restoreCv, restoreLetter } = aliasBriefIds(b);
    const draft: CvDraft = {
      headline: "x",
      summary: "y",
      experiences: [
        {
          factId: "e1",
          title: "t",
          location: null,
          bullets: [
            { text: "b", factIds: [{ kind: "achievement", id: "a1" }] },
            { text: "c", factIds: [{ kind: "achievement", id: "a99" }] },
          ],
          tech: [],
        },
      ],
      education: [{ factId: "ed1", course: "c", degree: null }],
      skills: [{ label: "L", items: [{ name: "n", factIds: [{ kind: "skill", id: "s1" }] }] }],
      projects: [{ factId: "p1", description: "d" }],
      adjacent: [{ asked: "K", shown: "D", factIds: [{ kind: "skill", id: "s2" }] }],
      sectionsOrder: ["summary"],
    };
    const real = restoreCv(draft);
    expect(real.experiences[0]?.factId).toBe(b.experiences[0]?.id);
    expect(real.experiences[0]?.bullets[0]?.factIds[0]?.id).toBe(
      b.experiences[0]?.achievements[0]?.id,
    );
    expect(real.experiences[0]?.bullets[1]?.factIds[0]?.id).toBe("a99");
    expect(real.education[0]?.factId).toBe(b.education[0]?.id);
    expect(real.skills[0]?.items[0]?.factIds[0]?.id).toBe(b.skills[0]?.id);
    expect(real.projects[0]?.factId).toBe(b.projects[0]?.id);
    expect(real.adjacent[0]?.factIds[0]?.id).toBe(b.skills[1]?.id);
    const letter: CoverLetterDraft = {
      headline: "h",
      greeting: "g",
      paragraphs: [
        { role: "covers", text: "x", factIds: [{ kind: "experience", id: "e2" }] },
        { role: "why", text: "y", factIds: [] },
        { role: "closing", text: "z", factIds: [] },
      ],
    };
    expect(restoreLetter(letter).paragraphs[0]?.factIds[0]?.id).toBe(b.experiences[1]?.id);
  });
});
