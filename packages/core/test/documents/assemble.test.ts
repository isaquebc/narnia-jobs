import type { CoverLetterDraft, CvDraft } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { assembleCoverLetter, assembleCv } from "../../src/documents/assemble";
import { buildCvBrief } from "../../src/documents/brief";
import { seedFixture } from "../../src/testing/profile-fixtures";

function setup(locale: "pt-BR" | "en-US" = "pt-BR") {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  const res = buildCvBrief(r, {
    kind: "cv",
    profileId: ids.profileId,
    postingId: null,
    locale,
    instructions: null,
    previousIssues: [],
  });
  return { r, ids, ...res };
}

const meta = (profileId: string) => ({
  locale: "pt-BR" as const,
  paper: "A4" as const,
  profileId,
  postingId: null,
  generatedAt: "2026-10-16T12:00:00Z",
});

function draftFor(b: ReturnType<typeof setup>["brief"]): CvDraft {
  const acme = b.experiences[0] as (typeof b.experiences)[number];
  const ach = acme.achievements[0] as (typeof acme.achievements)[number];
  return {
    headline: "Engenheira de Software Sênior",
    summary: "Engenheira de software com foco em pagamentos.",
    education: [],
    experiences: [
      {
        factId: acme.id,
        title: acme.title,
        location: "Remoto",
        bullets: [
          { text: `${ach.text}, ${ach.metric}.`, factIds: [{ kind: "achievement", id: ach.id }] },
        ],
        tech: ["TypeScript", "Node.js"],
      },
    ],
    skills: [
      {
        label: "Backend",
        items: [
          {
            name: "Node.js",
            factIds: [
              {
                kind: "skill",
                id: (b.skills.find((s) => s.name === "Node.js") as { id: string }).id,
              },
            ],
          },
        ],
      },
    ],
    projects: [],
    adjacent: [],
    sectionsOrder: ["summary", "experience", "skills", "education", "languages"],
  };
}

/** F05/M2 · montagem do CV a partir do rascunho: o código preenche cabeçalho, datas e scores e confere a origem. */
describe("F05/M2 core · montagem do CV", () => {
  it("rascunho válido vira CvContent com dados dos fatos, score, educação, idiomas e o roteiro", () => {
    const s = setup();
    const { content, issues } = assembleCv(s.r, s.brief, draftFor(s.brief), {
      meta: meta(s.ids.profileId),
      header: { name: "Ana", title: "Eng", location: null, email: null, phone: null, links: [] },
    });
    expect(issues).toEqual([]);
    const exp = content.experiences[0];
    expect(exp).toMatchObject({
      company: "Acme Pagamentos",
      start: "2023-02",
      end: null,
      location: "Remoto",
    });
    expect(exp?.matchScore).toBe(s.brief.experiences[0]?.matchScore);
    expect(content.skills[0]?.items[0]?.matchScore).toBeGreaterThan(0);
    expect(content.education.length).toBeGreaterThan(0);
    expect(content.languages.length).toBeGreaterThan(0);
    expect(content.provenance.factIdsUsed.length).toBeGreaterThan(0);
    // experiências que o gerador deixou de fora entram no roteiro, com o motivo
    expect(content.omitted.map((o) => o.company)).toContain("Beta Logística");
  });

  it("origem inexistente, experiência fora do resumo e tecnologia nova são apontadas", () => {
    const s = setup();
    const d = draftFor(s.brief);
    const e0 = d.experiences[0] as CvDraft["experiences"][number];
    d.experiences[0] = {
      ...e0,
      tech: [...e0.tech, "Rust"],
      bullets: [{ text: "Fez algo", factIds: [{ kind: "achievement", id: "nao-existe" }] }],
    };
    d.experiences.push({
      title: "x",
      location: null,
      factId: "inventada",
      bullets: [{ text: "x", factIds: [{ kind: "achievement", id: "nao-existe" }] }],
      tech: [],
    });
    const { issues } = assembleCv(s.r, s.brief, d, {
      meta: meta(s.ids.profileId),
      header: { name: "Ana", title: "Eng", location: null, email: null, phone: null, links: [] },
    });
    const msgs = issues.map((i) => i.message).join("\n");
    expect(issues.every((i) => i.area === "hallucination" && i.severity === "error")).toBe(true);
    expect(msgs).toMatch(/nao-existe/);
    expect(msgs).toMatch(/inventada/);
    expect(msgs).toMatch(/Rust/);
  });

  it("dados no idioma do documento: cargo, local e curso saem exatamente como nos dados, mesmo se o gerador traduzir", () => {
    const s = setup("pt-BR");
    expect(s.brief.sourceLocale).toBe("pt-BR");
    const d = draftFor(s.brief);
    const ed = s.brief.education[0] as { id: string; course: string | null };
    d.experiences[0] = {
      ...(d.experiences[0] as CvDraft["experiences"][number]),
      title: "Senior Software Engineer",
      location: "Remote",
    };
    d.education = [{ factId: ed.id, course: "Computer Science", degree: "Bachelor's degree" }];
    const { content } = assembleCv(s.r, s.brief, d, {
      meta: meta(s.ids.profileId),
      header: { name: "Ana", title: "", location: null, email: null, phone: null, links: [] },
    });
    const acme = s.r.facts.experiences.get(s.brief.experiences[0]?.id as string);
    expect(content.experiences[0]).toMatchObject({
      title: s.brief.experiences[0]?.title,
      location: acme?.location ?? null,
    });
    expect(content.education[0]?.course).toBe(ed.course);
  });

  it("CV em inglês: cargo-alvo, cargo, local e curso traduzidos pelo gerador; empresa, datas e instituição dos dados", () => {
    const s = setup("en-US");
    const d = draftFor(s.brief);
    const ed = s.brief.education[0] as { id: string };
    d.headline = "Senior Software Engineer";
    d.experiences[0] = {
      ...(d.experiences[0] as CvDraft["experiences"][number]),
      title: "Senior Software Engineer",
      location: "Remote",
    };
    d.education = [{ factId: ed.id, course: "Computer Science", degree: "Bachelor's degree" }];
    const header = {
      name: "Ana",
      title: "Engenheira",
      location: null,
      email: null,
      phone: null,
      links: [],
    };
    const { content, issues } = assembleCv(s.r, s.brief, d, {
      meta: { ...meta(s.ids.profileId), locale: "en-US" },
      header,
    });
    expect(issues).toEqual([]);
    expect(content.header.title).toBe("Senior Software Engineer");
    expect(content.experiences[0]).toMatchObject({
      company: "Acme Pagamentos",
      title: "Senior Software Engineer",
      location: "Remote",
      start: "2023-02",
    });
    expect(content.education[0]).toMatchObject({
      course: "Computer Science",
      institution: s.brief.education[0]?.institution,
    });
  });

  it("idiomas no idioma do documento pelo código (dono, 2026-10-19: 'Português (Native)' num CV em inglês)", () => {
    const en = setup("en-US");
    const a = assembleCv(en.r, en.brief, draftFor(en.brief), {
      meta: { ...meta(en.ids.profileId), locale: "en-US" },
      header: { name: "Ana", title: "", location: null, email: null, phone: null, links: [] },
    });
    expect(a.content.languages.map((l) => l.name)).toEqual(["Portuguese", "English"]);
    const pt = setup("pt-BR");
    const b = assembleCv(pt.r, pt.brief, draftFor(pt.brief), {
      meta: meta(pt.ids.profileId),
      header: { name: "Ana", title: "", location: null, email: null, phone: null, links: [] },
    });
    expect(b.content.languages.map((l) => l.name)).toEqual(["Português", "Inglês"]);
  });

  it("competência traduzida com a origem certa passa; tecnologia trocada não", () => {
    const s = setup();
    const mentoria = s.brief.skills.find((k) => k.name === "Mentoria") as { id: string };
    const docker = s.brief.skills.find((k) => k.name === "Docker") as { id: string };
    const d = draftFor(s.brief);
    d.skills = [
      {
        label: "Practices",
        items: [
          { name: "Mentoring", factIds: [{ kind: "skill", id: mentoria.id }] },
          { name: "Ansible", factIds: [{ kind: "skill", id: docker.id }] },
        ],
      },
    ];
    const header = {
      name: "Ana",
      title: "Eng",
      location: null,
      email: null,
      phone: null,
      links: [],
    };
    const { issues } = assembleCv(s.r, s.brief, d, { meta: meta(s.ids.profileId), header });
    expect(issues.map((i) => i.message)).toEqual(['A skill "Ansible" não está nos seus dados.']);
  });

  it("termo da vaga sem evidência escrito no CV é apontado; a adjacência com o nome verdadeiro passa", () => {
    const s = setup();
    const brief = { ...s.brief, gaps: ["Kafka"] };
    const d = draftFor(brief);
    d.summary = "Experiência com Kafka e mensageria.";
    const docker = s.brief.skills.find((k) => k.name === "Docker") as { id: string };
    d.adjacent = [{ asked: "Kafka", shown: "Docker", factIds: [{ kind: "skill", id: docker.id }] }];
    const { issues } = assembleCv(s.r, brief, d, {
      meta: meta(s.ids.profileId),
      header: { name: "Ana", title: "Eng", location: null, email: null, phone: null, links: [] },
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ area: "hallucination", message: expect.stringMatching(/Kafka/) }),
    );
    const ok = assembleCv(s.r, brief, draftFor(brief), {
      meta: meta(s.ids.profileId),
      header: { name: "Ana", title: "Eng", location: null, email: null, phone: null, links: [] },
    });
    expect(ok.issues).toEqual([]);
  });
});

describe("F05/M2 core · montagem da carta", () => {
  it("parágrafos com origem válida, assinatura com o nome e contagem de palavras", () => {
    const s = setup();
    const words = (n: number) => Array.from({ length: n }, (_, i) => `termo${i % 9}`).join(" ");
    const ach = s.brief.experiences[0]?.achievements[0] as { id: string };
    const draft: CoverLetterDraft = {
      greeting: "Olá, time da Initech",
      paragraphs: [
        { role: "why", text: words(80), factIds: [] },
        { role: "covers", text: words(120), factIds: [{ kind: "achievement", id: ach.id }] },
        { role: "gaps", text: words(60), factIds: [] },
        { role: "closing", text: words(40), factIds: [] },
      ],
    };
    const header = {
      name: "Ana Maria Exemplo",
      title: "Eng",
      location: null,
      email: null,
      phone: null,
      links: [],
    };
    const ok = assembleCoverLetter(s.brief, draft, {
      meta: { ...meta(s.ids.profileId), postingId: "v1", format: "text" },
      header,
    });
    expect(ok.issues).toEqual([]);
    expect(ok.content.signature).toBe("Ana Maria Exemplo");
    // sem headline (edição antiga): o cargo-alvo dos dados; com headline, o traduzido pelo gerador
    expect(ok.content.header.title).toBe("Eng");
    const en = assembleCoverLetter(
      s.brief,
      { ...draft, headline: "Senior Software Engineer" },
      { meta: { ...meta(s.ids.profileId), postingId: "v1", format: "text" }, header },
    );
    expect(en.content.header.title).toBe("Senior Software Engineer");
    const short = assembleCoverLetter(
      s.brief,
      { ...draft, paragraphs: draft.paragraphs.slice(0, 2) },
      { meta: { ...meta(s.ids.profileId), postingId: "v1", format: "text" }, header },
    );
    expect(short.issues).toContainEqual(
      expect.objectContaining({ area: "layout", message: expect.stringMatching(/palavras/) }),
    );
  });
});
