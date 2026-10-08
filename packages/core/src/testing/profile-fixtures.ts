import type {
  EducationDataSchema,
  EmphasisItem,
  ExperienceDataSchema,
  LanguageDataSchema,
  ProjectDataSchema,
  SkillDataSchema,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import type { ProfileCreate } from "../db/repos/profiles";
import type { UserPatch } from "../db/repos/users";

/**
 * Fixtures de perfil (F02 §2.9-6), fictícias ("Ana Maria Exemplo"), compartilhadas por testes do core,
 * `MockProvider.analyzeProfiles` e `POST /api/_test/seed`. `seedFixture` grava sempre pelos repos, nunca por SQL.
 */
export const FIXTURE_NAMES = ["engineer", "leader", "long"] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

type ExperienceData = z.infer<typeof ExperienceDataSchema>;
type ProjectData = z.infer<typeof ProjectDataSchema>;
type EducationData = z.infer<typeof EducationDataSchema>;
type SkillData = z.infer<typeof SkillDataSchema>;
type LanguageData = z.infer<typeof LanguageDataSchema>;

export interface FixtureExperience extends ExperienceData {
  achievements: Array<{ text: string; metric?: string }>;
}

export interface ProfileFixture {
  user: UserPatch & { fullName: string; email: string };
  experiences: FixtureExperience[];
  projects: ProjectData[];
  education: EducationData[];
  skills: SkillData[];
  languages: LanguageData[];
  profile: Omit<ProfileCreate, "userId" | "isActive">;
  /** Ênfases iniciais por índice nas listas acima (resolvidas para ids no seed). */
  emphasis?: Array<{
    kind: "experience" | "skill" | "project";
    index: number;
    mode: EmphasisItem["mode"];
  }>;
}

export interface SeededIds {
  userId: string;
  profileId: string;
  experienceIds: string[];
  achievementIds: string[];
  projectIds: string[];
  educationIds: string[];
  skillIds: string[];
  languageIds: string[];
}

const USER_ANA: ProfileFixture["user"] = {
  displayName: "Ana",
  fullName: "Ana Maria Exemplo",
  email: "ana.exemplo@example.com",
  phone: { e164: "+5511987654321", country: "BR", national: "11987654321" },
  city: "Campinas",
  region: "SP",
  country: "BR",
  timezone: "America/Sao_Paulo",
  remotePref: "remote",
  relocation: { mode: "none", countries: [] },
  workAuth: [{ country: "BR", status: "citizen" }],
  links: [],
};

const skill = (name: string, category: SkillData["category"], level?: number): SkillData =>
  level === undefined ? { name, category } : { name, category, level };

const ENGINEER_SKILLS: SkillData[] = [
  skill("TypeScript", "language", 5),
  skill("Node.js", "framework", 5),
  skill("React", "framework", 4),
  skill("PostgreSQL", "data", 4),
  skill("SQLite", "data", 3),
  skill("Redis", "infra", 4),
  skill("Docker", "infra", 4),
  skill("Kubernetes", "infra", 3),
  skill("AWS", "infra", 3),
  skill("Terraform", "infra", 2),
  skill("GraphQL", "framework", 3),
  skill("REST", "domain", 5),
  skill("Testes automatizados", "tool", 5),
  skill("Observabilidade", "infra", 3),
  skill("Arquitetura de sistemas", "domain", 4),
  skill("Mentoria", "soft", 4),
  skill("Comunicação", "soft", 4),
  skill("Python", "language", 3),
  skill("Go", "language", 2),
  skill("Git", "tool", 5),
];

const ENGINEER: ProfileFixture = {
  user: USER_ANA,
  experiences: [
    {
      company: "Acme Pagamentos",
      title: "Engenheira de Software Sênior",
      employmentType: "clt",
      startDate: "2023-02",
      isCurrent: true,
      location: "Remoto",
      summary: "Plataforma de pagamentos com alta disponibilidade.",
      tech: ["TypeScript", "Node.js", "PostgreSQL", "Kubernetes"],
      achievements: [
        { text: "Reduziu a latência p95 do checkout", metric: "de 800 ms para 300 ms" },
        { text: "Liderou a migração para Kubernetes", metric: "zero downtime em 40 serviços" },
      ],
    },
    {
      company: "Beta Logística",
      title: "Engenheira de Software Pleno",
      employmentType: "clt",
      startDate: "2020-06",
      endDate: "2023-01",
      isCurrent: false,
      summary: "Roteirização e rastreio de entregas.",
      tech: ["TypeScript", "React", "Redis", "AWS"],
      achievements: [
        { text: "Criou o serviço de rastreio em tempo real", metric: "120 mil eventos/min" },
      ],
    },
    {
      company: "Gama Educação",
      title: "Desenvolvedora Full Stack",
      employmentType: "pj",
      startDate: "2018-03",
      endDate: "2020-05",
      isCurrent: false,
      tech: ["Node.js", "React", "PostgreSQL"],
      achievements: [{ text: "Entregou o portal do aluno", metric: "30 mil usuários ativos" }],
    },
    {
      company: "Delta Consultoria",
      title: "Desenvolvedora Backend",
      employmentType: "clt",
      startDate: "2016-08",
      endDate: "2018-02",
      isCurrent: false,
      tech: ["Python", "PostgreSQL"],
      achievements: [
        { text: "Automatizou a conciliação financeira", metric: "8 h/semana poupadas" },
      ],
    },
    {
      company: "Épsilon Startups",
      title: "Desenvolvedora Júnior",
      employmentType: "clt",
      startDate: "2015-01",
      endDate: "2016-07",
      isCurrent: false,
      tech: ["Python", "Git"],
      achievements: [{ text: "Implantou a suíte de testes automatizados" }],
    },
    {
      company: "Unicamp (iniciação científica)",
      title: "Estagiária de Desenvolvimento",
      employmentType: "internship",
      startDate: "2014-02",
      endDate: "2014-12",
      isCurrent: false,
      tech: ["Python"],
      achievements: [{ text: "Publicou ferramenta de coleta de dados", metric: "1 artigo" }],
    },
  ],
  projects: [
    {
      name: "narnia-jobs",
      description: "Agente recrutador local, open source.",
      url: "https://example.com/ana/narnia-jobs",
      role: "autora",
      startDate: "2026-01",
      tech: ["TypeScript", "SQLite"],
    },
    {
      name: "fila-leve",
      description: "Fila de jobs minimalista sobre Redis.",
      url: "https://example.com/ana/fila-leve",
      role: "mantenedora",
      startDate: "2022-05",
      endDate: "2023-09",
      tech: ["TypeScript", "Redis"],
    },
  ],
  education: [
    {
      institution: "Unicamp",
      course: "Ciência da Computação",
      degree: "Bacharelado",
      startDate: "2011",
      endDate: "2015",
      status: "completed",
    },
    {
      institution: "USP",
      course: "Engenharia de Software",
      degree: "Especialização",
      startDate: "2019",
      endDate: "2020",
      status: "completed",
    },
  ],
  skills: ENGINEER_SKILLS,
  languages: [
    { name: "Português", level: "native" },
    { name: "Inglês", level: "C1" },
  ],
  profile: {
    name: "Eng. Software Sênior",
    targetTitle: "Senior Backend Engineer",
    altTitles: ["Engenheira de Software Sênior"],
    seniority: "senior",
    area: "software",
    goal: "new_job",
    market: "BR",
    docLocale: "pt-BR",
    salary: { min: 18_000, max: 25_000, currency: "BRL", period: "monthly" },
    contractTypes: ["clt", "pj"],
    locations: [{ country: "BR", city: "Campinas", remote: "remote" }],
    availableFrom: "immediate",
    needsResearch: [],
    pitch: null,
  },
  emphasis: [
    { kind: "experience", index: 0, mode: "highlight" },
    { kind: "skill", index: 0, mode: "highlight" },
  ],
};

const LEADER: ProfileFixture = {
  user: { ...USER_ANA, displayName: "Ana", fullName: "Ana Maria Exemplo" },
  experiences: [
    {
      company: "Zeta Fintech",
      title: "Engineering Manager",
      employmentType: "clt",
      startDate: "2024-01",
      isCurrent: true,
      summary: "Gestão de duas squads de plataforma (14 pessoas).",
      tech: ["TypeScript", "Kubernetes"],
      achievements: [
        { text: "Reduziu o lead time de entrega", metric: "de 12 para 5 dias" },
        { text: "Contratou e integrou", metric: "8 pessoas em 6 meses" },
      ],
    },
    {
      company: "Acme Pagamentos",
      title: "Tech Lead",
      employmentType: "clt",
      startDate: "2021-03",
      endDate: "2023-12",
      isCurrent: false,
      summary: "Liderança técnica da squad de checkout.",
      tech: ["TypeScript", "Node.js", "PostgreSQL"],
      achievements: [{ text: "Conduziu o roadmap técnico", metric: "3 lançamentos/trimestre" }],
    },
    {
      company: "Beta Logística",
      title: "Engenheira de Software Sênior",
      employmentType: "clt",
      startDate: "2018-01",
      endDate: "2021-02",
      isCurrent: false,
      tech: ["TypeScript", "React", "Redis"],
      achievements: [{ text: "Mentorou", metric: "4 desenvolvedores promovidos" }],
    },
  ],
  projects: [],
  education: [
    {
      institution: "Unicamp",
      course: "Ciência da Computação",
      degree: "Bacharelado",
      startDate: "2010",
      endDate: "2014",
      status: "completed",
    },
  ],
  skills: [
    skill("Gestão de pessoas", "management", 4),
    skill("Planejamento de roadmap", "management", 4),
    skill("Contratação", "management", 3),
    skill("OKRs", "management", 3),
    skill("TypeScript", "language", 5),
    skill("Arquitetura de sistemas", "domain", 4),
    skill("Comunicação", "soft", 5),
  ],
  languages: [
    { name: "Português", level: "native" },
    { name: "Inglês", level: "C1" },
  ],
  profile: {
    name: "Eng. Software Sênior",
    targetTitle: "Senior Software Engineer",
    altTitles: [],
    seniority: "senior",
    area: "software",
    goal: "new_job",
    market: "BR",
    docLocale: "pt-BR",
    salary: { min: 20_000, max: 28_000, currency: "BRL", period: "monthly" },
    contractTypes: ["clt"],
    locations: [{ country: "BR", remote: "remote" }],
    availableFrom: "immediate",
    needsResearch: [],
    pitch: null,
  },
};

function longFixture(): ProfileFixture {
  const companies = [
    "Alfa",
    "Beta",
    "Gama",
    "Delta",
    "Épsilon",
    "Zeta",
    "Eta",
    "Teta",
    "Iota",
    "Kapa",
  ];
  const experiences: FixtureExperience[] = Array.from({ length: 20 }, (_, i) => {
    const startYear = 2006 + i;
    return {
      company: `${companies[i % companies.length]} ${Math.floor(i / companies.length) + 1} Ltda.`,
      title:
        i >= 15
          ? "Engenheira de Software Sênior"
          : i >= 8
            ? "Engenheira de Software"
            : "Desenvolvedora",
      employmentType: "clt",
      startDate: `${startYear}-01`,
      ...(i === 19 ? {} : { endDate: `${startYear}-12` }),
      isCurrent: i === 19,
      tech: ["TypeScript", "Node.js"],
      achievements: [
        { text: `Entrega ${i + 1} concluída no prazo`, metric: `${(i + 1) * 5}% de ganho` },
      ],
    };
  });
  const categories: SkillData["category"][] = [
    "language",
    "framework",
    "infra",
    "data",
    "tool",
    "domain",
  ];
  const skills: SkillData[] = Array.from({ length: 60 }, (_, i) =>
    skill(
      `Skill ${String(i + 1).padStart(2, "0")}`,
      categories[i % categories.length] as SkillData["category"],
      (i % 5) + 1,
    ),
  );
  return {
    ...ENGINEER,
    experiences,
    skills,
    projects: [],
    emphasis: [],
    profile: {
      ...ENGINEER.profile,
      name: "Perfil longo",
      pitch: "Vinte anos construindo sistemas.",
    },
  };
}

export const PROFILE_FIXTURES: Record<FixtureName, ProfileFixture> = {
  engineer: ENGINEER,
  leader: LEADER,
  long: longFixture(),
};

/** Grava a fixture pelos repos: usuário completo, fatos verificados, perfil ativo e ênfases iniciais. */
export function seedFixture(repos: Repos, name: FixtureName): SeededIds {
  const f = PROFILE_FIXTURES[name];
  const user = repos.users.upsert(f.user);
  const meta = { confidence: 1, verified: true };
  const experienceIds: string[] = [];
  const achievementIds: string[] = [];
  for (const { achievements, ...exp } of f.experiences) {
    const e = repos.facts.experiences.insert({ ...exp, ...meta });
    experienceIds.push(e.id);
    for (const a of achievements) {
      achievementIds.push(
        repos.facts.achievements.insert({ ...a, experienceId: e.id, ...meta }).id,
      );
    }
  }
  const projectIds = f.projects.map((p) => repos.facts.projects.insert({ ...p, ...meta }).id);
  const educationIds = f.education.map((e) => repos.facts.education.insert({ ...e, ...meta }).id);
  const skillIds = f.skills.map((s) => repos.facts.skills.insert({ ...s, ...meta }).id);
  const languageIds = f.languages.map((l) => repos.facts.languages.insert({ ...l, ...meta }).id);
  const profile = repos.profiles.create({ ...f.profile, userId: user.id, isActive: true });
  const ids: SeededIds = {
    userId: user.id,
    profileId: profile.id,
    experienceIds,
    achievementIds,
    projectIds,
    educationIds,
    skillIds,
    languageIds,
  };
  const lists = { experience: experienceIds, skill: skillIds, project: projectIds };
  const items: EmphasisItem[] = (f.emphasis ?? []).map((e) => ({
    kind: e.kind,
    id: lists[e.kind][e.index] as string,
    mode: e.mode,
  }));
  if (items.length > 0) repos.emphasis.replace(profile.id, items);
  // cartão nunca foi gerado: reconstrução na primeira leitura (F02 §2.9-14)
  repos.profiles.invalidateCard(profile.id);
  return ids;
}
