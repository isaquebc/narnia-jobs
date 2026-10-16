import type { CoverLetterContent, CvContent } from "@narnia-jobs/shared";

/** Conteúdos de exemplo da F05 (fictícios): CV curto, CV longo (passa de 2 páginas) e carta. */
const ref = (id: string, kind: "achievement" | "skill" | "experience" = "achievement") => ({
  kind,
  id,
});

export const HEADER: CvContent["header"] = {
  name: "Ana Souza",
  title: "Engenheira de Software Sênior",
  location: "Campinas, SP",
  email: "ana@example.com",
  phone: "(19) 99999-0000",
  links: [
    { kind: "email", url: "mailto:ana@example.com", label: "ana@example.com" },
    { kind: "whatsapp", url: "https://wa.me/5519999990000", label: "WhatsApp" },
    {
      kind: "linkedin",
      url: "https://www.linkedin.com/in/ana-souza",
      label: "linkedin.com/in/ana-souza",
    },
    { kind: "github", url: "https://github.com/anasouza", label: "github.com/anasouza" },
  ],
};

export const CV_SHORT: CvContent = {
  meta: {
    kind: "cv",
    locale: "pt-BR",
    paper: "A4",
    profileId: "p1",
    postingId: null,
    generatedAt: "2026-10-16T12:00:00Z",
  },
  header: HEADER,
  summary: "Engenheira backend com 9 anos em pagamentos, foco em performance e confiabilidade.",
  experiences: [
    {
      factId: "e1",
      company: "Acme Pagamentos",
      title: "Engenheira de Software Sênior",
      start: "2021-03",
      end: null,
      location: "Remoto",
      bullets: [
        { text: "Reduziu a latência p95 do checkout de 800 ms para 300 ms.", factIds: [ref("a1")] },
        {
          text: "Liderou a migração de 40 serviços para Docker <com> orquestração própria.",
          factIds: [ref("a2")],
        },
      ],
      tech: ["Node.js", "PostgreSQL", "Docker"],
      matchScore: 92,
    },
    {
      factId: "e2",
      company: "Globex",
      title: "Desenvolvedora Backend",
      start: "2017-01",
      end: "2021-02",
      location: "São Paulo, SP",
      bullets: [
        { text: "Criou a API de conciliação usada por 300 lojistas.", factIds: [ref("a3")] },
      ],
      tech: ["Java", "Kafka"],
      matchScore: 70,
    },
  ],
  skills: [
    {
      label: "Backend",
      items: [
        { name: "Node.js", factIds: [ref("s1", "skill")], matchScore: 95 },
        { name: "PostgreSQL", factIds: [ref("s2", "skill")], matchScore: 90 },
      ],
    },
  ],
  projects: [],
  education: [
    {
      factId: "ed1",
      institution: "Unicamp",
      course: "Ciência da Computação",
      degree: "Bacharelado",
      start: "2012",
      end: "2016",
    },
  ],
  languages: [{ factId: "l1", name: "Inglês", level: "C1" }],
  adjacent: [],
  sectionsOrder: ["summary", "experience", "skills", "education", "languages"],
  omitted: [
    {
      factId: "e0",
      company: "Startup X",
      title: "Estagiária",
      reason: "Pouca aderência.",
      matchScore: 10,
    },
  ],
  provenance: { factIdsUsed: [ref("a1"), ref("a2"), ref("a3")], unverifiedFactIds: [] },
};

export function cvLong(): CvContent {
  const exps = Array.from({ length: 9 }, (_, i) => ({
    factId: `x${i}`,
    company: `Empresa ${i + 1}`,
    title: "Engenheira de Software",
    start: `${2004 + i * 2}-01`,
    end: `${2005 + i * 2}-12`,
    location: "São Paulo, SP",
    bullets: Array.from({ length: 5 }, (_, j) => ({
      text: `Entrega ${j + 1} com impacto mensurável em custo, prazo e qualidade para o time de produto e operações.`,
      factIds: [ref(`a${i}${j}`)],
    })),
    tech: ["Java", "Spring", "Oracle"],
    matchScore: 60,
  }));
  return { ...CV_SHORT, experiences: [...CV_SHORT.experiences, ...exps] };
}

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i % 7}`).join(" ");

export const LETTER: CoverLetterContent = {
  meta: {
    kind: "cover_letter",
    locale: "pt-BR",
    paper: "A4",
    profileId: "p1",
    postingId: "v1",
    generatedAt: "2026-10-16T12:00:00Z",
    format: "pdf",
  },
  header: HEADER,
  greeting: "Olá, time da Acme",
  paragraphs: [
    { role: "why", text: words(70, "motivo"), factIds: [] },
    { role: "covers", text: words(90, "cubro"), factIds: [ref("a1")] },
    { role: "gaps", text: words(70, "aprender"), factIds: [] },
    { role: "closing", text: words(40, "conversa"), factIds: [] },
  ],
  signature: "Ana Souza",
};
