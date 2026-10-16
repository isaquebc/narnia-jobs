import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  buildCvBrief,
  documentLocale,
  languageCoverage,
  profileHash,
} from "../../src/documents/brief";
import { analyzePostingText } from "../../src/postings/heuristics";
import { matchKeywords } from "../../src/postings/match";
import { seedFixture } from "../../src/testing/profile-fixtures";

const JD_EN = `Senior Backend Engineer
Company: Initech
Requirements:
- 5+ years with Node.js and TypeScript
- Kubernetes in production
- Kafka and event streaming
Nice to have:
- Terraform
We are a remote-first team building payment rails.`;

function setup(fixture: "engineer" | "long" = "engineer") {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, fixture);
  return { r, ids };
}

function postingFor(r: ReturnType<typeof createRepos>, text = JD_EN) {
  const p = r.postings.create(
    {
      company: "Initech",
      title: "Senior Backend Engineer",
      jdText: text,
      skillsRequired: ["Node.js", "Kubernetes", "Kafka"],
    },
    { source: "user" },
  );
  const keywords = matchKeywords(r, analyzePostingText(text).keywords);
  r.postings.setPreAnalysis(p.id, {
    version: 1,
    keywords,
    ngrams: [],
    sectionsDetected: true,
    yearsMin: 5,
    coverage: 0.66,
    risksByProfile: {},
    createdAt: "2026-10-16T00:00:00Z",
  });
  return r.postings.get(p.id) as NonNullable<ReturnType<typeof r.postings.get>>;
}

/** F05/M2 · resumo do gerador: score de match, ocultos, roteiro de entrevista, lacunas e idioma. */
describe("F05/M2 core · idioma do documento (F05-16)", () => {
  it("CV da vaga no idioma da vaga; sem vaga, o do perfil", () => {
    const { r, ids } = setup();
    const profile = r.profiles.get(ids.profileId) as NonNullable<ReturnType<typeof r.profiles.get>>;
    expect(documentLocale(profile, null)).toBe("pt-BR");
    expect(documentLocale(profile, { jdText: JD_EN })).toBe("en-US");
    expect(
      documentLocale(profile, {
        jdText: "Vaga para desenvolvedor com experiência em Node.js e para o time de pagamentos",
      }),
    ).toBe("pt-BR");
  });

  it("idioma coberto: inglês B2 ou mais; português para quem mora no Brasil", () => {
    expect(languageCoverage([{ name: "Inglês", level: "C1" }], { country: "BR" }, "en-US")).toEqual(
      { covered: true, language: "Inglês" },
    );
    expect(
      languageCoverage([{ name: "English", level: "B1" }], { country: "BR" }, "en-US").covered,
    ).toBe(false);
    expect(languageCoverage([], { country: "BR" }, "en-US").covered).toBe(false);
    expect(languageCoverage([], { country: "BR" }, "pt-BR").covered).toBe(true);
    expect(languageCoverage([], { country: "US" }, "pt-BR")).toEqual({
      covered: false,
      language: "Português",
    });
  });
});

describe("F05/M2 core · resumo do gerador", () => {
  it("CV do perfil: experiências e skills com score, ocultos fora, sem vaga e sem lacunas", () => {
    const { r, ids } = setup();
    r.emphasis.replace(ids.profileId, [
      { kind: "experience", id: ids.experienceIds[1] as string, mode: "hidden" },
    ]);
    const { brief } = buildCvBrief(r, {
      kind: "cv",
      profileId: ids.profileId,
      postingId: null,
      locale: "pt-BR",
      instructions: null,
      previousIssues: [],
    });
    expect(brief.posting).toBeNull();
    expect(brief.gaps).toEqual([]);
    expect(brief.experiences.map((e) => e.company)).not.toContain("Beta Logística");
    expect(brief.omitted.map((e) => e.company)).not.toContain("Beta Logística");
    expect(brief.experiences.every((e) => e.matchScore >= 0 && e.matchScore <= 100)).toBe(true);
    const scores = brief.experiences.map((e) => e.matchScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(brief.profile).toMatchObject({ name: "Ana Maria Exemplo" });
  });

  it("CV da vaga: requisitos com evidência pesam no score, lacunas listadas (Kafka), Kubernetes não é lacuna", () => {
    const { r, ids } = setup();
    const posting = postingFor(r);
    const { brief, atsTerms } = buildCvBrief(r, {
      kind: "cv",
      profileId: ids.profileId,
      postingId: posting.id,
      locale: "en-US",
      instructions: "Foque em liderança",
      previousIssues: [],
    });
    expect(brief.posting).toMatchObject({ company: "Initech", title: "Senior Backend Engineer" });
    expect(brief.gaps).toContain("Kafka");
    expect(brief.gaps).not.toContain("Kubernetes");
    expect(brief.instructions).toBe("Foque em liderança");
    const acme = brief.experiences.find((e) => e.company === "Acme Pagamentos");
    const delta = brief.experiences.find((e) => e.company === "Delta Consultoria");
    expect(acme?.matchScore).toBeGreaterThan(delta?.matchScore ?? 100);
    expect(brief.experiences[0]?.company).toBe("Acme Pagamentos");
    expect(atsTerms.find((t) => t.term === "Kafka")).toMatchObject({
      hasEvidence: false,
      weight: 2,
    });
    expect(atsTerms.find((t) => t.term === "Kubernetes")).toMatchObject({ hasEvidence: true });
    const k8s = brief.skills.find((s) => s.name === "Kubernetes");
    const go = brief.skills.find((s) => s.name === "Go");
    expect(k8s?.matchScore).toBeGreaterThan(go?.matchScore ?? 100);
  });

  it("carreira longa: as de score baixo e antigas viram roteiro de entrevista; no máximo 6 no CV", () => {
    const { r, ids } = setup("long");
    const posting = postingFor(r);
    const { brief } = buildCvBrief(r, {
      kind: "cv",
      profileId: ids.profileId,
      postingId: posting.id,
      locale: "en-US",
      instructions: null,
      previousIssues: [],
    });
    expect(brief.experiences.length).toBeLessThanOrEqual(6);
    expect(brief.omitted.length).toBeGreaterThan(0);
    expect(brief.omitted[0]?.reason).toMatch(/score/);
  });

  it("perfil mudou (campos ou ênfases) = hash diferente; fatos não entram no hash", () => {
    const { r, ids } = setup();
    const p = r.profiles.get(ids.profileId) as NonNullable<ReturnType<typeof r.profiles.get>>;
    const h1 = profileHash(p, r.emphasis.list(ids.profileId));
    r.emphasis.replace(ids.profileId, [
      { kind: "skill", id: ids.skillIds[0] as string, mode: "highlight" },
    ]);
    const h2 = profileHash(p, r.emphasis.list(ids.profileId));
    expect(h2).not.toBe(h1);
    expect(profileHash({ ...p, targetTitle: "Outro" }, r.emphasis.list(ids.profileId))).not.toBe(
      h2,
    );
  });
});
