import { afterEach, describe, expect, it } from "vitest";
import {
  makeTestApp,
  simulateWorker,
  type TestApp,
  uploadFixture,
  VALID_PROFILE,
  VALID_USER,
} from "./helpers";

const put = (body: unknown) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M4/api usuário (identidade + telefone obrigatório) e perfil (carreira obrigatória, DIEESE)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET /api/user devolve null antes do onboarding; PUT valida telefone (país + DDD) e grava E.164", async () => {
    t = makeTestApp();
    expect(await (await t.api("/api/user")).json()).toEqual({ user: null });
    const res = await t.api("/api/user", put(VALID_USER));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { phone: { e164: string }; timezone: string } };
    expect(body.user.phone.e164).toBe("+5511987654321");
    expect(body.user.timezone).toBe("America/Sao_Paulo");
    const bad = await t.api(
      "/api/user",
      put({ ...VALID_USER, phone: { e164: "+5500123", country: "BR", national: "00123" } }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: expect.stringMatching(/phone|invalid|too_short/) },
    });
    const { phone: _p, ...noPhone } = VALID_USER;
    expect((await t.api("/api/user", put(noPhone))).status).toBe(400);
    // e164 informado inconsistente é recalculado a partir de país + nacional
    const fixed = await t.api(
      "/api/user",
      put({
        ...VALID_USER,
        phone: { e164: "+15551234567", country: "BR", national: "11987654321" },
      }),
    );
    expect(((await fixed.json()) as { user: { phone: { e164: string } } }).user.phone.e164).toBe(
      "+5511987654321",
    );
  });

  it("POST /api/profiles cria o primeiro perfil ativo; faixa BRL mensal abaixo da referência DIEESE marca salaryBelowReference (só informa)", async () => {
    t = makeTestApp();
    await t.api("/api/user", put(VALID_USER));
    const ok = await t.api("/api/profiles", post(VALID_PROFILE));
    expect(ok.status).toBe(201);
    const p = (await ok.json()) as { isActive: boolean; salaryBelowReference: boolean; id: string };
    expect(p.isActive).toBe(true);
    expect(p.salaryBelowReference).toBe(false);

    const low = await t.api(
      "/api/profiles",
      post({
        ...VALID_PROFILE,
        name: "Baixo",
        salary: { min: 3000, max: 5000, currency: "BRL", period: "monthly" },
      }),
    );
    expect(low.status).toBe(201);
    expect(((await low.json()) as { salaryBelowReference: boolean }).salaryBelowReference).toBe(
      true,
    );

    const usd = await t.api(
      "/api/profiles",
      post({
        ...VALID_PROFILE,
        name: "USD",
        salary: { min: 1000, max: 2000, currency: "USD", period: "monthly" },
      }),
    );
    expect(((await usd.json()) as { salaryBelowReference: boolean }).salaryBelowReference).toBe(
      false,
    );
    const list = (await (await t.api("/api/profiles")).json()) as {
      profiles: Array<{ isActive: boolean }>;
    };
    expect(list.profiles).toHaveLength(3);
    expect(list.profiles.filter((x) => x.isActive)).toHaveLength(1);
  });

  it("campo obrigatório ausente sem needsResearch → 400; com needsResearch grava provisório (BRL = referência DIEESE) e marca pendência", async () => {
    t = makeTestApp();
    await t.api("/api/user", put(VALID_USER));
    const { salary: _s, ...noSalary } = VALID_PROFILE;
    expect((await t.api("/api/profiles", post(noSalary))).status).toBe(400);
    const res = await t.api("/api/profiles", post({ ...noSalary, needsResearch: ["salary"] }));
    expect(res.status).toBe(201);
    const p = (await res.json()) as {
      salary: { min: number; currency: string; period: string } | undefined;
      needsResearch: string[];
      salaryBelowReference: boolean;
    };
    expect(p.needsResearch).toEqual(["salary"]);
    const ref = t.repos.salaryReferences.current("BR");
    expect(p.salary).toMatchObject({ min: ref?.value, currency: "BRL", period: "monthly" });
    expect(p.salaryBelowReference).toBe(false);
  });

  it("GET /api/profiles/suggestion?runId= sugere cargo/senioridade/área a partir dos fatos aceitos (ou das propostas do run)", async () => {
    t = makeTestApp();
    const { body: file } = await uploadFixture(t);
    const ing = (await (await t.api("/api/ingestions", post({ fileId: file.id }))).json()) as {
      id: string;
    };
    simulateWorker(t, ing.id);
    const res = await t.api(`/api/profiles/suggestion?runId=${ing.id}`);
    expect(res.status).toBe(200);
    const s = (await res.json()) as {
      targetTitle: string | null;
      seniority: string | null;
      area: string | null;
      reasons: string[];
    };
    expect(s.targetTitle).toBe("Engenheira de Software Sênior");
    expect(s.area).toBe("software");
    expect(["pleno", "senior", "staff"]).toContain(s.seniority);
    expect(s.reasons.length).toBeGreaterThan(0);
    const empty = (await (await t.api("/api/profiles/suggestion")).json()) as {
      targetTitle: string | null;
    };
    expect(empty.targetTitle).toBeNull();
  });

  it("onboarding/state: GET padrão passo 1; PUT persiste e GET devolve", async () => {
    t = makeTestApp();
    expect(await (await t.api("/api/onboarding/state")).json()).toEqual({
      step: 1,
      completed: false,
    });
    const res = await t.api(
      "/api/onboarding/state",
      put({ step: 4, completed: false, runId: "r1" }),
    );
    expect(res.status).toBe(200);
    expect(await (await t.api("/api/onboarding/state")).json()).toEqual({
      step: 4,
      completed: false,
      runId: "r1",
    });
    expect((await t.api("/api/onboarding/state", put({ step: 9 }))).status).toBe(400);
  });
});
