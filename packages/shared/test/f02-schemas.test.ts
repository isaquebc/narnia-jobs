import { describe, expect, it } from "vitest";
import {
  AnalyzeProfilesInputSchema,
  AnalyzeProfilesOutputSchema,
  DashboardResponseSchema,
  EmphasisFactKindSchema,
  EmphasisPutRequestSchema,
  FACT_KINDS,
  FactProposalSchema,
  PersonaOverridesSchema,
  PersonaSchema,
  ProfileBaseSchema,
  ProfileCardSchema,
  ProfileCreateRequestSchema,
  ProfileEmphasisSchema,
  ProfileFactRelevanceSchema,
  ProfilePatchRequestSchema,
  ProfileSchema,
  ProfileSuggestionSchema,
  ProfileWsEventSchema,
  ProjectDataSchema,
} from "../src/index";
import analyzeOutput from "./fixtures/analyze-profiles-output.valid.json";
import persona from "./fixtures/persona.valid.json";
import profile from "./fixtures/profile.valid.json";
import card from "./fixtures/profile-card.valid.json";
import emphasis from "./fixtures/profile-emphasis.valid.json";
import suggestion from "./fixtures/profile-suggestion.valid.json";

describe("F02/M1 shared · ênfases e relevância", () => {
  it("EmphasisFactKind cobre os seis tipos, na ordem da UI", () => {
    expect(EmphasisFactKindSchema.options).toEqual([
      "experience",
      "project",
      "skill",
      "education",
      "language",
      "achievement",
    ]);
  });
  it("ProfileEmphasis aceita a fixture, exige modo do enum e posição inteira ≥ 0 ou nula", () => {
    expect(ProfileEmphasisSchema.safeParse(emphasis).success).toBe(true);
    expect(ProfileEmphasisSchema.safeParse({ ...emphasis, mode: "top" }).success).toBe(false);
    expect(ProfileEmphasisSchema.safeParse({ ...emphasis, position: -1 }).success).toBe(false);
    expect(ProfileEmphasisSchema.safeParse({ ...emphasis, position: 1.5 }).success).toBe(false);
    expect(ProfileEmphasisSchema.safeParse({ ...emphasis, position: null }).success).toBe(true);
  });
  it("ProfileFactRelevance tem nota entre 0 e 1 e motivos como lista", () => {
    const ok = {
      profileId: "p1",
      factKind: "skill",
      factId: "s1",
      score: 0.75,
      reasons: ["recent", "highlight"],
      computedAt: "2026-10-08T12:00:00.000Z",
    };
    expect(ProfileFactRelevanceSchema.safeParse(ok).success).toBe(true);
    expect(ProfileFactRelevanceSchema.safeParse({ ...ok, score: 1.2 }).success).toBe(false);
    expect(ProfileFactRelevanceSchema.safeParse({ ...ok, reasons: "recent" }).success).toBe(false);
  });
  it("EmphasisPutRequest: itens com kind/id/mode e posição opcional", () => {
    expect(
      EmphasisPutRequestSchema.safeParse({
        items: [{ kind: "experience", id: "e1", mode: "hidden" }],
      }).success,
    ).toBe(true);
    expect(
      EmphasisPutRequestSchema.safeParse({ items: [{ kind: "repo", id: "e1", mode: "normal" }] })
        .success,
    ).toBe(false);
  });
});

describe("F02/M1 shared · persona (F02-7)", () => {
  it("Persona aceita a fixture e só valores dos enums", () => {
    expect(PersonaSchema.safeParse(persona).success).toBe(true);
    expect(PersonaSchema.safeParse({ ...persona, tone: "agressivo" }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...persona, honesty: "baixa" }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...persona, rigor: "nenhum" }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...persona, recruiterSeniority: "junior" }).success).toBe(
      false,
    );
  });
  it("PersonaOverrides: todos opcionais, aceitam null (restaurar), rejeitam fora do enum", () => {
    expect(PersonaOverridesSchema.parse({})).toEqual({});
    expect(PersonaOverridesSchema.safeParse({ tone: "cordial", rigor: null }).success).toBe(true);
    expect(PersonaOverridesSchema.safeParse({ tone: "qualquer" }).success).toBe(false);
    expect(PersonaOverridesSchema.safeParse({ specialty: "" }).success).toBe(false);
    expect(PersonaOverridesSchema.safeParse({ language: "portugues" }).success).toBe(false);
  });
});

describe("F02/M1 shared · cartão e sugestões", () => {
  it("ProfileCard: tokensEst inteiro ≥ 0, hash e builtAt em UTC", () => {
    expect(ProfileCardSchema.safeParse(card).success).toBe(true);
    expect(ProfileCardSchema.safeParse({ ...card, tokensEst: 2.5 }).success).toBe(false);
    expect(ProfileCardSchema.safeParse({ ...card, tokensEst: -1 }).success).toBe(false);
    expect(ProfileCardSchema.safeParse({ ...card, hash: "" }).success).toBe(false);
    expect(ProfileCardSchema.safeParse({ ...card, builtAt: "ontem" }).success).toBe(false);
  });
  it("ProfileSuggestion: source heuristic|model, status new|accepted|dismissed", () => {
    expect(ProfileSuggestionSchema.safeParse(suggestion).success).toBe(true);
    expect(ProfileSuggestionSchema.safeParse({ ...suggestion, source: "user" }).success).toBe(
      false,
    );
    expect(ProfileSuggestionSchema.safeParse({ ...suggestion, status: "later" }).success).toBe(
      false,
    );
    expect(
      ProfileSuggestionSchema.safeParse({ ...suggestion, source: "heuristic", model: null })
        .success,
    ).toBe(true);
  });
  it("AnalyzeProfilesOutput aceita a fixture, limita a 5 e exige justificativa", () => {
    expect(AnalyzeProfilesOutputSchema.safeParse(analyzeOutput).success).toBe(true);
    const one = analyzeOutput.suggestions[0];
    expect(AnalyzeProfilesOutputSchema.safeParse({ suggestions: Array(6).fill(one) }).success).toBe(
      false,
    );
    expect(
      AnalyzeProfilesOutputSchema.safeParse({ suggestions: [{ ...one, rationale: "" }] }).success,
    ).toBe(false);
  });
  it("AnalyzeProfilesInput: entrada compacta com listas vazias por padrão", () => {
    const parsed = AnalyzeProfilesInputSchema.parse({
      identity: { name: "Ana Maria Exemplo", city: "Campinas", country: "BR" },
    });
    expect(parsed.experiences).toEqual([]);
    expect(parsed.existingProfiles).toEqual([]);
    expect(parsed.dismissedTitles).toEqual([]);
  });
});

describe("F02/M1 shared · projetos (F02-9) e perfil estendido", () => {
  it("project entra em FACT_KINDS e na união de propostas", () => {
    expect(FACT_KINDS).toContain("project");
    expect(
      FactProposalSchema.safeParse({
        kind: "project",
        confidence: 0.8,
        data: { name: "narnia-jobs", description: "Agente recrutador", tech: ["TypeScript"] },
      }).success,
    ).toBe(true);
    expect(ProjectDataSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("ProfileBase ganha personaOverrides, archivedAt, clonedFrom e cardFactsVersion (opcionais)", () => {
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    const extended = ProfileSchema.parse({
      ...profile,
      personaOverrides: { tone: "cordial" },
      archivedAt: "2026-10-08T12:00:00.000Z",
      clonedFrom: "prof_00",
      cardFactsVersion: 3,
    });
    expect(extended.personaOverrides).toEqual({ tone: "cordial" });
    expect(extended.cardFactsVersion).toBe(3);
    expect(ProfileSchema.safeParse({ ...profile, cardFactsVersion: 1.5 }).success).toBe(false);
    for (const k of ["personaOverrides", "archivedAt", "clonedFrom", "cardFactsVersion"]) {
      expect(k in ProfileBaseSchema.shape).toBe(true);
    }
  });
  it("ProfileCreateRequest não aceita os campos internos novos e aceita activate", () => {
    const { id: _i, userId: _u, isActive: _a, ...body } = profile;
    expect(ProfileCreateRequestSchema.safeParse({ ...body, activate: true }).success).toBe(true);
    const parsed = ProfileCreateRequestSchema.parse({
      ...body,
      archivedAt: "2026-10-08T12:00:00.000Z",
      clonedFrom: "x",
    });
    expect(parsed).not.toHaveProperty("archivedAt");
    expect(parsed).not.toHaveProperty("clonedFrom");
  });
  it("ProfilePatchRequest: tudo parcial, sem id/userId/isActive/campos internos", () => {
    expect(ProfilePatchRequestSchema.safeParse({ pitch: "Nova narrativa" }).success).toBe(true);
    expect(ProfilePatchRequestSchema.safeParse({}).success).toBe(true);
    const parsed = ProfilePatchRequestSchema.parse({ isActive: true, cardJson: "x", name: "N" });
    expect(parsed).toEqual({ name: "N" });
    expect(ProfilePatchRequestSchema.safeParse({ seniority: "guru" }).success).toBe(false);
  });
});

describe("F02/M1 shared · dashboard e WS", () => {
  it("Dashboard estendido com card, emphasis e suggestions (opcionais até M3)", () => {
    const base = {
      profile: null,
      counts: { experiences: 0, skills: 0, education: 0, files: 0 },
      usage: { totalTokens: 0, byCategory: {} },
      pendingResearch: 0,
    };
    expect(DashboardResponseSchema.safeParse(base).success).toBe(true);
    expect(
      DashboardResponseSchema.safeParse({
        ...base,
        counts: { ...base.counts, projects: 2 },
        card: { text: "x", builtAt: "2026-10-08T12:00:00.000Z", valid: true },
        emphasis: { highlighted: 2, hidden: 1 },
        suggestions: 1,
      }).success,
    ).toBe(true);
    expect(
      DashboardResponseSchema.safeParse({ ...base, card: { text: "x", valid: true } }).success,
    ).toBe(false);
    expect(DashboardResponseSchema.safeParse({ ...base, suggestions: 1.5 }).success).toBe(false);
  });
  it("eventos WS do F02 definidos (entram na união em M4): profile.switched e profile.card_invalidated", () => {
    expect(
      ProfileWsEventSchema.safeParse({ type: "profile.switched", profileId: "p1" }).success,
    ).toBe(true);
    expect(
      ProfileWsEventSchema.safeParse({ type: "profile.card_invalidated", profileIds: ["p1", "p2"] })
        .success,
    ).toBe(true);
    expect(ProfileWsEventSchema.safeParse({ type: "profile.card_invalidated" }).success).toBe(
      false,
    );
    expect(
      ProfileWsEventSchema.safeParse({ type: "profile.card_invalidated", profileIds: [] }).success,
    ).toBe(false);
  });
});
