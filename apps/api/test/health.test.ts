import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

describe("M1/api GET /api/health", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("responde ok com a versão", async () => {
    t = makeTestApp();
    const res = await t.app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "0.0.0-test" });
  });

  it("devolve 404 em rota desconhecida (autenticada)", async () => {
    t = makeTestApp();
    const res = await t.api("/api/nao-existe");
    expect(res.status).toBe(404);
  });
});
