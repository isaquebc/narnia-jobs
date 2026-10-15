import type { Posting, PostingNote } from "@narnia-jobs/shared";
import type { PostingAnalysisView } from "../../src/lib/api";

const NOW = "2026-10-14T12:00:00.000Z";

export function posting(id: string, partial: Partial<Posting> = {}): Posting {
  return {
    id,
    status: "ready",
    company: "Globex Consultoria",
    client: "Initech Bank",
    title: "Desenvolvedor(a) Backend Sênior",
    role: "backend",
    seniority: "senior",
    city: "São Paulo",
    state: "SP",
    country: "BR",
    workMode: "hybrid",
    contractType: "clt",
    currency: "BRL",
    salaryMin: 15000,
    salaryMax: 20000,
    salaryPeriod: "monthly",
    benefits: ["Vale refeição"],
    responsibilities: [],
    skillsRequired: ["Java"],
    skillsNice: ["AWS"],
    companySummary: null,
    postingUrl: null,
    companyUrl: null,
    jdText: "Requisitos: Java",
    publishedAt: null,
    identityHash: "h",
    fieldSources: { company: "both", client: "model", title: "heuristic", jdText: "user" },
    preAnalysis: {
      version: 1,
      keywords: [
        {
          term: "Java",
          category: "language",
          section: "required",
          count: 2,
          source: "both",
          evidence: [{ kind: "skill", id: "sk1", label: "Java" }],
        },
        {
          term: "AWS",
          category: "cloud",
          section: "nice",
          count: 1,
          source: "heuristic",
          evidence: [],
        },
      ],
      ngrams: ["ZeroMQ"],
      sectionsDetected: true,
      yearsMin: 5,
      coverage: 1,
      risksByProfile: {
        p1: [
          {
            type: "work_mode",
            description: "Vaga híbrida; perfil só remoto.",
            source: "heuristic",
          },
        ],
      },
      createdAt: NOW,
    },
    rawPath: null,
    duplicate: null,
    createdAt: NOW,
    updatedAt: NOW,
    contentUpdatedAt: NOW,
    ...partial,
  };
}

export function note(id: string, partial: Partial<PostingNote> = {}): PostingNote {
  return {
    id,
    postingId: "v1",
    author: "user",
    body: "Falei com a Joana",
    pendingBody: null,
    pendingAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

export function analysis(partial: Partial<PostingAnalysisView> = {}): PostingAnalysisView {
  return {
    id: "a1",
    postingId: "v1",
    recommendedProfileId: "p1",
    factsVersion: 3,
    postingUpdatedAt: NOW,
    models: ["sonnet"],
    chatSessionId: "s7",
    createdAt: NOW,
    stale: { facts: false, posting: false },
    labels: { "skill:sk1": "Java" },
    analysis: {
      summary: "Boa aderência ao perfil de backend.",
      profiles: [{ profileId: "p1", fit: 78, rationale: "Backend sênior.", confidence: "high" }],
      recommendedProfileId: "p1",
      recommendationRationale: "Único perfil com Java.",
      matches: [
        { requirement: "Java", evidence: [{ kind: "skill", id: "sk1" }], strength: "strong" },
      ],
      gaps: [
        {
          requirement: "Kafka",
          severity: "minor",
          evidenceChecked: true,
          suggestion: "Citar mensageria.",
        },
        {
          requirement: "AWS",
          severity: "blocking",
          evidenceChecked: true,
          suggestion: "Estudar AWS.",
        },
      ],
      risks: [{ type: "salary", description: "Faixa perto do mínimo.", source: "model" }],
      atsKeywordsMissing: [{ term: "Kafka", where: "skills" }],
      likelyQuestions: [{ question: "Conte um incidente.", why: "Sustentação.", evidence: [] }],
      studyRecommendations: [{ topic: "AWS", why: "Diferencial." }],
      cvImprovements: [{ suggestion: "Métricas nas conquistas.", why: "Impacto." }],
      seniority: { asked: "senior", profile: "senior", note: "Compatível." },
    },
    ...partial,
  };
}
