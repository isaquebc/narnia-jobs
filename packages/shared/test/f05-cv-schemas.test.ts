import { describe, expect, it } from "vitest";
import {
  CoverLetterContentSchema,
  CvContentSchema,
  CvReviewSchema,
  coverLetterWordCount,
} from "../src/index";

/** F05/M1 · conteúdo do CV e da carta, e a revisão (F05 §2.2). */
const header = {
  name: "Ana Souza",
  title: "Engenheira de Software Sênior",
  location: "Campinas, BR",
  email: "ana@example.com",
  phone: "+55 19 99999-0000",
  links: [
    { kind: "email", url: "mailto:ana@example.com", label: "ana@example.com" },
    { kind: "whatsapp", url: "https://wa.me/5519999990000", label: "WhatsApp" },
    { kind: "linkedin", url: "https://www.linkedin.com/in/ana", label: "linkedin.com/in/ana" },
  ],
};
const ref = (id: string, kind = "achievement") => ({ kind, id });

const cvFixture = {
  meta: {
    kind: "cv",
    locale: "pt-BR",
    paper: "A4",
    profileId: "p1",
    postingId: null,
    generatedAt: "2026-10-16T12:00:00Z",
  },
  header,
  summary: "Engenheira backend com 9 anos em pagamentos.",
  experiences: [
    {
      factId: "e1",
      company: "Acme Pay",
      title: "Engenheira de Software Sênior",
      start: "2021-03",
      end: null,
      location: "Remoto",
      bullets: [{ text: "Reduziu a latência do checkout em 40%.", factIds: [ref("a1")] }],
      tech: ["Node.js", "PostgreSQL"],
      matchScore: 92,
    },
  ],
  skills: [
    {
      label: "Backend",
      items: [{ name: "Node.js", factIds: [ref("s1", "skill")], matchScore: 95 }],
    },
  ],
  projects: [],
  education: [],
  languages: [],
  adjacent: [{ asked: "Kubernetes", shown: "Docker", factIds: [ref("s2", "skill")] }],
  sectionsOrder: ["summary", "experience", "skills"],
  omitted: [
    {
      factId: "e0",
      company: "Startup X",
      title: "Dev",
      reason: "Pouca aderência à vaga.",
      matchScore: 12,
    },
  ],
  provenance: { factIdsUsed: [ref("a1"), ref("s1", "skill")], unverifiedFactIds: [] },
};

describe("F05 shared · CvContent", () => {
  it("aceita a fixture pt-BR e a en-US em Letter", () => {
    expect(CvContentSchema.safeParse(cvFixture).success).toBe(true);
    const en = { ...cvFixture, meta: { ...cvFixture.meta, locale: "en-US", paper: "Letter" } };
    expect(CvContentSchema.safeParse(en).success).toBe(true);
  });

  it("rejeita bullet sem origem, seção desconhecida, score fora de 0–100 e link de tipo desconhecido", () => {
    const exp = cvFixture.experiences[0] as (typeof cvFixture.experiences)[number];
    const noFacts = {
      ...cvFixture,
      experiences: [{ ...exp, bullets: [{ text: "x", factIds: [] }] }],
    };
    expect(CvContentSchema.safeParse(noFacts).success).toBe(false);
    expect(CvContentSchema.safeParse({ ...cvFixture, sectionsOrder: ["hobbies"] }).success).toBe(
      false,
    );
    expect(
      CvContentSchema.safeParse({ ...cvFixture, experiences: [{ ...exp, matchScore: 120 }] })
        .success,
    ).toBe(false);
    const badLink = {
      ...cvFixture,
      header: { ...header, links: [{ kind: "fax", url: "https://x.com", label: "x" }] },
    };
    expect(CvContentSchema.safeParse(badLink).success).toBe(false);
  });

  it("link só http(s), mailto ou wa.me", () => {
    const js = {
      ...cvFixture,
      header: { ...header, links: [{ kind: "other", url: "javascript:alert(1)", label: "x" }] },
    };
    expect(CvContentSchema.safeParse(js).success).toBe(false);
  });
});

describe("F05 shared · carta", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(" ");
  const letter = (n: number) => ({
    meta: { ...cvFixture.meta, kind: "cover_letter", postingId: "v1", format: "text" },
    header,
    greeting: "Olá, time da Acme",
    paragraphs: [
      { role: "why", text: words(Math.floor(n / 2)), factIds: [] },
      { role: "covers", text: words(n - Math.floor(n / 2)), factIds: [ref("a1")] },
    ],
    signature: "Ana Souza",
  });

  it("250 a 400 palavras no corpo; exige a vaga", () => {
    expect(coverLetterWordCount(letter(300))).toBe(300);
    expect(CoverLetterContentSchema.safeParse(letter(300)).success).toBe(true);
    expect(CoverLetterContentSchema.safeParse(letter(120)).success).toBe(false);
    expect(CoverLetterContentSchema.safeParse(letter(520)).success).toBe(false);
    const semVaga = letter(300);
    expect(
      CoverLetterContentSchema.safeParse({ ...semVaga, meta: { ...semVaga.meta, postingId: null } })
        .success,
    ).toBe(false);
  });

  it("parágrafo que cita o que cobre exige origem", () => {
    const l = letter(300);
    l.paragraphs[1] = { ...(l.paragraphs[1] as (typeof l.paragraphs)[number]), factIds: [] };
    expect(CoverLetterContentSchema.safeParse(l).success).toBe(false);
  });
});

describe("F05 shared · revisão", () => {
  it("apontamentos por área; nota ATS de 0 a 100 ou null (carta)", () => {
    const ok = CvReviewSchema.safeParse({
      passed: false,
      atsScore: 84,
      issues: [{ area: "ats", severity: "error", message: "Nota 84 < 90.", where: null }],
    });
    expect(ok.success).toBe(true);
    expect(CvReviewSchema.safeParse({ passed: true, atsScore: null, issues: [] }).success).toBe(
      true,
    );
    expect(CvReviewSchema.safeParse({ passed: true, atsScore: 101, issues: [] }).success).toBe(
      false,
    );
    expect(
      CvReviewSchema.safeParse({
        passed: false,
        atsScore: null,
        issues: [{ area: "humor", severity: "error", message: "x", where: null }],
      }).success,
    ).toBe(false);
  });
});
