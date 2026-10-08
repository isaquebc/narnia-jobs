import { describe, expect, it } from "vitest";
import {
  EstimateResponseSchema,
  IngestionCreateRequestSchema,
  OnboardingStateSchema,
  ProfileCreateRequestSchema,
  ReviewRequestSchema,
  TextCreateRequestSchema,
  UserUpsertRequestSchema,
  WsEventSchema,
} from "../src/index";
import profile from "./fixtures/profile.valid.json";
import user from "./fixtures/user.valid.json";

describe("M2/shared · contratos de API (F01 §2.6)", () => {
  it("IngestionCreateRequest liga OCR e leitura pelo modelo por padrão", () => {
    const parsed = IngestionCreateRequestSchema.parse({ fileId: "f1" });
    expect(parsed.options).toEqual({ ocr: true, modelRead: true });
    expect(
      IngestionCreateRequestSchema.parse({ fileId: "f1", options: { ocr: false } }).options,
    ).toEqual({ ocr: false, modelRead: true });
  });

  it("TextCreateRequest exige entre 200 e 50 000 caracteres", () => {
    expect(TextCreateRequestSchema.safeParse({ text: "curto" }).success).toBe(false);
    expect(TextCreateRequestSchema.safeParse({ text: "a".repeat(200) }).success).toBe(true);
    expect(TextCreateRequestSchema.safeParse({ text: "a".repeat(50_001) }).success).toBe(false);
  });

  it("ReviewRequest exige editedData quando a decisão é 'edited'", () => {
    expect(
      ReviewRequestSchema.safeParse({ decisions: [{ proposalId: "p1", decision: "accepted" }] })
        .success,
    ).toBe(true);
    expect(
      ReviewRequestSchema.safeParse({ decisions: [{ proposalId: "p1", decision: "edited" }] })
        .success,
    ).toBe(false);
    expect(
      ReviewRequestSchema.safeParse({
        decisions: [{ proposalId: "p1", decision: "edited", editedData: { name: "Golang" } }],
      }).success,
    ).toBe(true);
    expect(ReviewRequestSchema.safeParse({ decisions: [] }).success).toBe(false);
  });

  it("UserUpsertRequest é o usuário sem id e timestamps", () => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...body } = user;
    expect(UserUpsertRequestSchema.safeParse(body).success).toBe(true);
    expect(UserUpsertRequestSchema.safeParse({ ...body, id: "x" }).success).toBe(true);
    const { phone: _p, ...semTelefone } = body;
    expect(UserUpsertRequestSchema.safeParse(semTelefone).success).toBe(false);
  });

  it("ProfileCreateRequest mantém a regra de obrigatórios com needsResearch", () => {
    const { id: _id, userId: _uid, isActive: _a, salaryBelowReference: _s, ...body } = profile;
    expect(ProfileCreateRequestSchema.safeParse(body).success).toBe(true);
    const { salary: _sal, ...semSalario } = body;
    expect(ProfileCreateRequestSchema.safeParse(semSalario).success).toBe(false);
    expect(
      ProfileCreateRequestSchema.safeParse({ ...semSalario, needsResearch: ["salary"] }).success,
    ).toBe(true);
  });

  it("EstimateResponse soma as chamadas", () => {
    const r = EstimateResponseSchema.parse({
      calls: [
        { name: "readDocument", model: "haiku", tokens: 4000 },
        { name: "extractFacts", model: "haiku", tokens: 6000 },
      ],
      totalTokens: 10000,
    });
    expect(r.totalTokens).toBe(10000);
    expect(EstimateResponseSchema.safeParse({ calls: [], totalTokens: 5 }).success).toBe(false);
  });

  it("OnboardingState tem passo entre 1 e 5 (wizard sem passo 6)", () => {
    expect(OnboardingStateSchema.safeParse({ step: 6, completed: false }).success).toBe(false);
    expect(
      OnboardingStateSchema.safeParse({ step: 3, completed: false, runId: "r1" }).success,
    ).toBe(true);
  });

  it("WsEvent é união discriminada por type", () => {
    expect(
      WsEventSchema.safeParse({ type: "job.progress", jobId: "j1", stage: "ocr", progress: 30 })
        .success,
    ).toBe(true);
    expect(WsEventSchema.safeParse({ type: "job.done", jobId: "j1" }).success).toBe(true);
    expect(
      WsEventSchema.safeParse({ type: "job.error", jobId: "j1", error: "falhou" }).success,
    ).toBe(true);
    expect(
      WsEventSchema.safeParse({
        type: "provider.status",
        status: {
          installed: true,
          loggedIn: true,
          authMethod: "claude.ai",
          version: "2.1.0",
          loginHint: null,
        },
      }).success,
    ).toBe(true);
    expect(WsEventSchema.safeParse({ type: "algo" }).success).toBe(false);
  });
});
