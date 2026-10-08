import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

describe("GET /api/salary-reference (F01-15 · alerta DIEESE na UI)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("devolve a referência corrente do país e null quando não há", async () => {
    t = makeTestApp();
    const br = await t.api("/api/salary-reference?country=BR");
    expect(br.status).toBe(200);
    const body = (await br.json()) as {
      reference: { source: string; currency: string; value: number } | null;
    };
    expect(body.reference).toMatchObject({ source: "dieese", currency: "BRL" });
    expect(body.reference?.value).toBeGreaterThan(0);
    const us = await t.api("/api/salary-reference?country=US");
    expect(((await us.json()) as { reference: unknown }).reference).toBeNull();
  });

  it("sem país usa o do usuário ou BR", async () => {
    t = makeTestApp();
    const res = await t.api("/api/salary-reference");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reference: { country: string } }).reference.country).toBe("BR");
  });
});
