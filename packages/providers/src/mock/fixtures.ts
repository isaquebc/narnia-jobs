import type {
  AnalyzeProfilesOutput,
  BuildDigestOutput,
  ExtractFactsOutput,
  ReadDocumentOutput,
} from "@narnia-jobs/shared";

/**
 * Fixtures FICTÍCIAS do provider mock (mesma pessoa inventada das fixtures do core: "Ana Maria Exemplo").
 * Nenhum dado real. Usadas em desenvolvimento, testes de API/worker e e2e.
 */

export const MOCK_CV_TEXT = `ANA MARIA EXEMPLO
Engenheira de Software | Campinas, SP | ana.exemplo@example.com | +55 (11) 98765-4321
github.com/exemplo | linkedin.com/in/exemplo

RESUMO
Engenheira de software com 7 anos de experiência em backend, Go e Kubernetes.
Foco em sistemas distribuídos, observabilidade e liderança técnica de times pequenos.

EXPERIÊNCIA
Acme Ltda — Engenheira de Software Sênior (CLT) — mar/2021 a nov/2023 — Campinas, SP
- Reduziu a latência p95 da API de pagamentos em 40% com cache distribuído.
- Liderou a migração de 12 serviços para Kubernetes, sem downtime.
Globex S.A. — Desenvolvedora Pleno — jan/2018 a fev/2021 — São Paulo, SP (híbrido)
- Implementou pipeline de CI/CD que cortou o tempo de deploy de 2 h para 15 min.

FORMAÇÃO
Unicamp — Bacharelado em Ciência da Computação — 2013 a 2017

SKILLS
Go, Kubernetes, PostgreSQL, Docker, Terraform, Observabilidade, Liderança técnica

IDIOMAS
Português (nativo), Inglês (C1)`;

export const MOCK_READ_DOCUMENT: ReadDocumentOutput = {
  text: MOCK_CV_TEXT,
  sections: [
    { title: "RESUMO", start: 143, end: 330 },
    { title: "EXPERIÊNCIA", start: 332, end: 760 },
    { title: "FORMAÇÃO", start: 762, end: 830 },
    { title: "SKILLS", start: 832, end: 920 },
    { title: "IDIOMAS", start: 922, end: 965 },
  ],
};

export const MOCK_EXTRACT_FACTS: ExtractFactsOutput = {
  identity: {
    confidence: 0.95,
    displayName: "Ana",
    fullName: "Ana Maria Exemplo",
    email: "ana.exemplo@example.com",
    phoneRaw: "+55 (11) 98765-4321",
    city: "Campinas",
    region: "SP",
    country: "BR",
    links: [
      { label: "GitHub", url: "https://github.com/exemplo" },
      { label: "LinkedIn", url: "https://linkedin.com/in/exemplo" },
    ],
  },
  experiences: [
    {
      confidence: 0.92,
      company: "Acme Ltda",
      title: "Engenheira de Software Sênior",
      employmentType: "clt",
      startDate: "2021-03",
      endDate: "2023-11",
      isCurrent: false,
      location: "Campinas, SP",
      summary: "Backend de pagamentos em Go, plataforma Kubernetes.",
      tech: ["Go", "Kubernetes", "PostgreSQL"],
      achievements: [
        {
          confidence: 0.9,
          text: "Reduziu a latência p95 da API de pagamentos em 40% com cache distribuído.",
          metric: "-40% p95",
        },
        {
          confidence: 0.88,
          text: "Liderou a migração de 12 serviços para Kubernetes, sem downtime.",
          metric: "12 serviços",
        },
      ],
    },
    {
      confidence: 0.9,
      company: "Globex S.A.",
      title: "Desenvolvedora Pleno",
      startDate: "2018-01",
      endDate: "2021-02",
      isCurrent: false,
      location: "São Paulo, SP",
      tech: ["Docker", "CI/CD"],
      achievements: [
        {
          confidence: 0.85,
          text: "Implementou pipeline de CI/CD que cortou o tempo de deploy de 2 h para 15 min.",
          metric: "2h → 15min",
        },
      ],
    },
  ],
  education: [
    {
      confidence: 0.93,
      institution: "Unicamp",
      course: "Ciência da Computação",
      degree: "Bacharelado",
      startDate: "2013",
      endDate: "2017",
      status: "completed",
    },
  ],
  skills: [
    { confidence: 0.95, name: "Go", category: "language" },
    { confidence: 0.95, name: "Kubernetes", category: "infra" },
    { confidence: 0.9, name: "PostgreSQL", category: "data" },
    { confidence: 0.9, name: "Docker", category: "infra" },
    { confidence: 0.8, name: "Terraform", category: "infra" },
    { confidence: 0.7, name: "Liderança técnica", category: "management" },
  ],
  languages: [
    { confidence: 0.95, name: "Português", level: "native" },
    { confidence: 0.9, name: "Inglês", level: "C1" },
  ],
  links: [{ confidence: 0.9, label: "GitHub", url: "https://github.com/exemplo" }],
};

export const MOCK_DIGEST: BuildDigestOutput = {
  summary:
    "Currículo de Ana Maria Exemplo, engenheira de software com cerca de 7 anos de experiência em backend (Go, Kubernetes, PostgreSQL), passagens pela Acme Ltda (sênior, 2021–2023) e Globex S.A. (pleno, 2018–2021), formação em Ciência da Computação pela Unicamp e inglês C1.",
  keyPoints: [
    "Acme Ltda · Engenheira de Software Sênior · 2021-03 a 2023-11",
    "Globex S.A. · Desenvolvedora Pleno · 2018-01 a 2021-02",
    "Unicamp · Bacharelado em Ciência da Computação · 2013–2017",
    "Tecnologias: Go, Kubernetes, PostgreSQL, Docker, Terraform",
    "Idiomas: Português nativo, Inglês C1",
    "Conquistas com métrica: -40% latência p95; deploy de 2 h para 15 min",
  ],
  sections: MOCK_READ_DOCUMENT.sections,
  meta: { pages: 1, language: "pt" },
};

/**
 * Sugestões do modelo no mock (F02 §2.6): coerentes com as fixtures `engineer`/`leader` do core.
 * `supportingFactIds` é preenchido em runtime com ids da entrada (ver `MockProvider.analyzeProfiles`).
 */
export const MOCK_ANALYZE_PROFILES: AnalyzeProfilesOutput = {
  suggestions: [
    {
      title: "Engineering Manager",
      seniority: "senior",
      area: "management",
      market: "BR",
      rationale:
        "Liderança de squads e contratação recorrentes nas experiências mais recentes; métricas de entrega e de time.",
      supportingFactIds: [],
    },
    {
      title: "Staff Engineer",
      seniority: "staff",
      area: "software",
      market: "BR",
      rationale:
        "Trajetória técnica longa em backend e plataforma, com conquistas de desempenho e arquitetura que cruzam times.",
      supportingFactIds: [],
    },
  ],
};
