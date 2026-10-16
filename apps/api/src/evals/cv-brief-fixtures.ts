import type { CvBrief } from "@narnia-jobs/shared";

/**
 * Resumo real do CV do perfil (fixture `engineer`, dados fictícios) que o gerador recebeu na instância de testes em
 * 2026-10-16: pt-BR, sem vaga, cargo-alvo do perfil escrito em inglês. Com o prompt anterior, 3 de 4 gerações saíram
 * com os cargos em inglês e o título do cabeçalho em inglês, e o revisor reprovou por idioma.
 */
export const CV_BRIEF_PT_TARGET_EN: CvBrief = {
  kind: "cv",
  locale: "pt-BR",
  sourceLocale: "pt-BR",
  maxPages: 2,
  profile: {
    name: "Ana Maria Exemplo",
    targetTitle: "Senior Backend Engineer",
    seniority: "senior",
    area: "software",
    pitch: null,
    yearsExperience: 10,
  },
  posting: null,
  experiences: [
    {
      id: "01a1461c-df50-711e-8a72-393899412b35",
      company: "Acme Pagamentos",
      title: "Engenheira de Software Sênior",
      start: "2023-02",
      end: null,
      current: true,
      summary: "Plataforma de pagamentos com alta disponibilidade.",
      tech: ["TypeScript", "Node.js", "PostgreSQL", "Kubernetes"],
      matchScore: 90,
      achievements: [
        {
          id: "01a1461c-df53-76a5-b4b8-f46c06b6c09c",
          text: "Reduziu a latência p95 do checkout",
          metric: "de 800 ms para 300 ms",
          highlight: false,
        },
        {
          id: "01a1461c-df55-7514-a0f2-0764e2ed7428",
          text: "Liderou a migração para Kubernetes",
          metric: "zero downtime em 40 serviços",
          highlight: false,
        },
      ],
    },
    {
      id: "01a1461c-df57-71d4-9b5a-cd3416e7f1bb",
      company: "Beta Logística",
      title: "Engenheira de Software Pleno",
      start: "2020-06",
      end: "2023-01",
      current: false,
      summary: "Roteirização e rastreio de entregas.",
      tech: ["TypeScript", "React", "Redis", "AWS"],
      matchScore: 66,
      achievements: [
        {
          id: "01a1461c-df59-7218-98dd-348cd1855d1f",
          text: "Criou o serviço de rastreio em tempo real",
          metric: "120 mil eventos/min",
          highlight: false,
        },
      ],
    },
    {
      id: "01a1461c-dfa6-7786-8acd-3c524277622a",
      company: "Delta Consultoria",
      title: "Desenvolvedora Backend",
      start: "2016-08",
      end: "2018-02",
      current: false,
      summary: null,
      tech: ["Python", "PostgreSQL"],
      matchScore: 43,
      achievements: [
        {
          id: "01a1461c-dfa9-7104-ab6c-915e96733c58",
          text: "Automatizou a conciliação financeira",
          metric: "8 h/semana poupadas",
          highlight: false,
        },
      ],
    },
    {
      id: "01a1461c-df6b-7761-b9a7-f9245ec1d056",
      company: "Gama Educação",
      title: "Desenvolvedora Full Stack",
      start: "2018-03",
      end: "2020-05",
      current: false,
      summary: null,
      tech: ["Node.js", "React", "PostgreSQL"],
      matchScore: 39,
      achievements: [
        {
          id: "01a1461c-df96-72a0-ac07-8a4b4e4f018f",
          text: "Entregou o portal do aluno",
          metric: "30 mil usuários ativos",
          highlight: false,
        },
      ],
    },
  ],
  omitted: [
    {
      id: "01a1461c-dfac-77c5-8d7c-1c3b1096a580",
      company: "Épsilon Startups",
      title: "Desenvolvedora Júnior",
      reason: "Pouca aderência ao perfil (score 30) e encerrada há 10 anos.",
    },
    {
      id: "01a1461c-dfb0-719e-b091-32cad9e316f1",
      company: "Unicamp (iniciação científica)",
      title: "Estagiária de Desenvolvimento",
      reason: "Pouca aderência ao perfil (score 30) e encerrada há 11 anos.",
    },
  ],
  skills: [
    {
      id: "01a1461c-dfbc-7452-b0ee-2ff607b7b532",
      name: "TypeScript",
      category: "language",
      matchScore: 70,
    },
    {
      id: "01a1461c-dfc9-70fc-a034-49b9cc72c563",
      name: "Kubernetes",
      category: "infra",
      matchScore: 55,
    },
    {
      id: "01a1461c-dfbe-7376-ae5d-4b2589509da3",
      name: "Node.js",
      category: "framework",
      matchScore: 55,
    },
    {
      id: "01a1461c-dfc2-7561-9b0b-b6ab5acf5c68",
      name: "PostgreSQL",
      category: "data",
      matchScore: 55,
    },
    {
      id: "01a1461c-dfcb-745d-a9cb-19b5bcd2310c",
      name: "AWS",
      category: "infra",
      matchScore: 46,
    },
    {
      id: "01a1461c-dfc0-7177-a8ae-18bb33f9247e",
      name: "React",
      category: "framework",
      matchScore: 46,
    },
    {
      id: "01a1461c-dfc5-7485-9519-c8db8b9d1b28",
      name: "Redis",
      category: "infra",
      matchScore: 46,
    },
    {
      id: "01a1461c-dfd7-73bf-88ef-8e27f886aae7",
      name: "Arquitetura de sistemas",
      category: "domain",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfda-7571-a148-6807dd1c92d2",
      name: "Comunicação",
      category: "soft",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfc7-7159-852c-e005ab5cd260",
      name: "Docker",
      category: "infra",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfde-7767-be88-d98e701af90f",
      name: "Go",
      category: "language",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfd0-7197-99e8-7cac36d18799",
      name: "GraphQL",
      category: "framework",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfd8-7111-8f67-cabd2dea41eb",
      name: "Mentoria",
      category: "soft",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfd5-722d-8816-ac9511ff07c0",
      name: "Observabilidade",
      category: "infra",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfd1-735b-a857-78130f810730",
      name: "REST",
      category: "domain",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfc3-725b-a874-049e3aa77683",
      name: "SQLite",
      category: "data",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfcd-770b-b83d-f1014028e49b",
      name: "Terraform",
      category: "infra",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfd3-7283-94e7-7cc6afc38cd5",
      name: "Testes automatizados",
      category: "tool",
      matchScore: 43,
    },
    {
      id: "01a1461c-dfdc-778e-a1bb-0910303a6014",
      name: "Python",
      category: "language",
      matchScore: 33,
    },
    {
      id: "01a1461c-dfe0-700b-85c0-6f1b0ef97bc4",
      name: "Git",
      category: "tool",
      matchScore: 30,
    },
  ],
  projects: [
    {
      id: "01a1461c-dfb4-7776-b8a0-84af7875888a",
      name: "narnia-jobs",
      description: "Agente recrutador local, open source.",
      tech: ["TypeScript", "SQLite"],
      matchScore: 55,
    },
    {
      id: "01a1461c-dfb6-76ef-abd8-b6cff02a9257",
      name: "fila-leve",
      description: "Fila de jobs minimalista sobre Redis.",
      tech: ["TypeScript", "Redis"],
      matchScore: 47,
    },
  ],
  education: [
    {
      id: "01a1461c-dfb8-71ab-b180-6e8b47f9821c",
      institution: "Unicamp",
      course: "Ciência da Computação",
      degree: "Bacharelado",
    },
    {
      id: "01a1461c-dfba-7309-8de0-53098ade4c70",
      institution: "USP",
      course: "Engenharia de Software",
      degree: "Especialização",
    },
  ],
  languages: [
    {
      id: "01a1461c-dfe2-7387-9265-5a6cd8f6294a",
      name: "Português",
      level: "native",
    },
    {
      id: "01a1461c-dfe4-74ae-9bf4-e92db91c1265",
      name: "Inglês",
      level: "C1",
    },
  ],
  gaps: [],
  instructions: null,
  previousIssues: [],
};
