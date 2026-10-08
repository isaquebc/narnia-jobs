import { describe, expect, it } from "vitest";
import {
  FactProposalSchema,
  FileDigestSchema,
  JobSchema,
  ProfileSchema,
  SalaryReferenceSchema,
  UsageEventSchema,
  UserSchema,
} from "../src/index";
import factProposals from "./fixtures/fact-proposals.valid.json";
import fileDigest from "./fixtures/file-digest.valid.json";
import job from "./fixtures/job.valid.json";
import profile from "./fixtures/profile.valid.json";
import salaryReference from "./fixtures/salary-reference.valid.json";
import usageEvent from "./fixtures/usage-event.valid.json";
import user from "./fixtures/user.valid.json";

describe("M2/shared · UserSchema", () => {
  it("aceita a fixture válida", () => {
    expect(UserSchema.safeParse(user).success).toBe(true);
  });
  it("exige telefone em E.164 com país e nacional só dígitos", () => {
    expect(
      UserSchema.safeParse({ ...user, phone: { ...user.phone, e164: "11987654321" } }).success,
    ).toBe(false);
    expect(
      UserSchema.safeParse({ ...user, phone: { ...user.phone, national: "11 98765-4321" } })
        .success,
    ).toBe(false);
    expect(UserSchema.safeParse({ ...user, phone: { ...user.phone, country: "br" } }).success).toBe(
      false,
    );
  });
  it("rejeita sem telefone, sem cidade ou sem país", () => {
    const { phone: _p, ...semTelefone } = user;
    expect(UserSchema.safeParse(semTelefone).success).toBe(false);
    expect(UserSchema.safeParse({ ...user, city: "" }).success).toBe(false);
    expect(UserSchema.safeParse({ ...user, country: "Brasil" }).success).toBe(false);
  });
  it("exige fuso IANA válido", () => {
    expect(UserSchema.safeParse({ ...user, timezone: "Brasilia" }).success).toBe(false);
    expect(UserSchema.safeParse({ ...user, timezone: "Europe/Lisbon" }).success).toBe(true);
  });
  it("relocação e situação de trabalho são obrigatórias", () => {
    const { relocation: _r, ...semRelocacao } = user;
    const { workAuth: _w, ...semWorkAuth } = user;
    expect(UserSchema.safeParse(semRelocacao).success).toBe(false);
    expect(UserSchema.safeParse(semWorkAuth).success).toBe(false);
    expect(UserSchema.safeParse({ ...user, workAuth: [] }).success).toBe(false);
    expect(
      UserSchema.safeParse({ ...user, relocation: { mode: "none", countries: [] } }).success,
    ).toBe(true);
  });
  it("timestamps em ISO UTC", () => {
    expect(UserSchema.safeParse({ ...user, createdAt: "07/10/2026" }).success).toBe(false);
  });
});

describe("M2/shared · ProfileSchema", () => {
  it("aceita a fixture válida", () => {
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
  });
  it("rejeita sem faixa salarial, contratos, localidades ou disponibilidade", () => {
    const { salary: _s, ...semSalario } = profile;
    expect(ProfileSchema.safeParse(semSalario).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...profile, contractTypes: [] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...profile, locations: [] }).success).toBe(false);
    const { availableFrom: _a, ...semDisp } = profile;
    expect(ProfileSchema.safeParse(semDisp).success).toBe(false);
  });
  it("aceita campo ausente quando marcado em needsResearch", () => {
    const { salary: _s, ...semSalario } = profile;
    expect(ProfileSchema.safeParse({ ...semSalario, needsResearch: ["salary"] }).success).toBe(
      true,
    );
    expect(
      ProfileSchema.safeParse({ ...profile, contractTypes: [], needsResearch: ["contractTypes"] })
        .success,
    ).toBe(true);
  });
  it("valida faixa salarial: min <= max, moeda ISO-4217, período conhecido", () => {
    expect(
      ProfileSchema.safeParse({ ...profile, salary: { ...profile.salary, min: 30000 } }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({ ...profile, salary: { ...profile.salary, currency: "R$" } })
        .success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({ ...profile, salary: { ...profile.salary, period: "weekly" } })
        .success,
    ).toBe(false);
  });
  it("disponibilidade aceita 'immediate' ou data ISO", () => {
    expect(ProfileSchema.safeParse({ ...profile, availableFrom: "2026-11-01" }).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...profile, availableFrom: "amanhã" }).success).toBe(false);
  });
});

describe("M2/shared · FactProposalSchema", () => {
  it("aceita todos os tipos da fixture", () => {
    for (const p of factProposals) {
      const r = FactProposalSchema.safeParse(p);
      expect(
        r.success,
        `kind=${p.kind}: ${JSON.stringify(r.success ? null : r.error.issues)}`,
      ).toBe(true);
    }
  });
  it("rejeita kind desconhecido e confiança fora de 0–1", () => {
    expect(FactProposalSchema.safeParse({ kind: "hobby", confidence: 0.5, data: {} }).success).toBe(
      false,
    );
    expect(FactProposalSchema.safeParse({ ...factProposals[4], confidence: 1.5 }).success).toBe(
      false,
    );
  });
  it("experiência exige empresa, título e data de início no formato YYYY-MM ou YYYY-MM-DD", () => {
    const exp = factProposals[1] as {
      kind: string;
      confidence: number;
      data: Record<string, unknown>;
    };
    expect(
      FactProposalSchema.safeParse({ ...exp, data: { ...exp.data, startDate: "março de 2021" } })
        .success,
    ).toBe(false);
    expect(
      FactProposalSchema.safeParse({ ...exp, data: { ...exp.data, startDate: "2021-03-01" } })
        .success,
    ).toBe(true);
    expect(
      FactProposalSchema.safeParse({ ...exp, data: { ...exp.data, company: "" } }).success,
    ).toBe(false);
  });
});

describe("M2/shared · FileDigestSchema", () => {
  it("aceita a fixture e rejeita resumo vazio ou seção invertida", () => {
    expect(FileDigestSchema.safeParse(fileDigest).success).toBe(true);
    expect(FileDigestSchema.safeParse({ ...fileDigest, summary: "" }).success).toBe(false);
    expect(
      FileDigestSchema.safeParse({ ...fileDigest, sections: [{ title: "X", start: 50, end: 10 }] })
        .success,
    ).toBe(false);
  });
});

describe("M2/shared · JobSchema, UsageEventSchema, SalaryReferenceSchema", () => {
  it("aceitam as fixtures válidas", () => {
    expect(JobSchema.safeParse(job).success).toBe(true);
    expect(UsageEventSchema.safeParse(usageEvent).success).toBe(true);
    expect(SalaryReferenceSchema.safeParse(salaryReference).success).toBe(true);
  });
  it("job: progresso 0–100 e status conhecido", () => {
    expect(JobSchema.safeParse({ ...job, progress: 101 }).success).toBe(false);
    expect(JobSchema.safeParse({ ...job, status: "running" }).success).toBe(false);
  });
  it("usage: tokens não negativos e origem conhecida", () => {
    expect(UsageEventSchema.safeParse({ ...usageEvent, inputTokens: -1 }).success).toBe(false);
    expect(UsageEventSchema.safeParse({ ...usageEvent, origin: "outro" }).success).toBe(false);
  });
  it("referência salarial: mês YYYY-MM, valor positivo, URL válida", () => {
    expect(
      SalaryReferenceSchema.safeParse({ ...salaryReference, referenceMonth: "09/2026" }).success,
    ).toBe(false);
    expect(SalaryReferenceSchema.safeParse({ ...salaryReference, value: 0 }).success).toBe(false);
    expect(
      SalaryReferenceSchema.safeParse({ ...salaryReference, sourceUrl: "dieese" }).success,
    ).toBe(false);
  });
});
