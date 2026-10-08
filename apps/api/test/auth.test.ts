import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

describe("M4/api autenticação por token de boot (F01-7)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("/api/health não exige token; as demais rotas devolvem 401 sem token ou com token errado", async () => {
    t = makeTestApp();
    expect((await t.app.request("/api/health")).status).toBe(200);
    const noToken = await t.app.request("/api/provider/status");
    expect(noToken.status).toBe(401);
    expect(await noToken.json()).toMatchObject({ error: { code: "unauthorized" } });
    const wrong = await t.app.request("/api/provider/status", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);
    expect((await t.api("/api/provider/status")).status).toBe(200);
  });

  it("/api/auth/enter?token= grava cookie HttpOnly e redireciona; cookie passa a autenticar", async () => {
    t = makeTestApp();
    const res = await t.app.request(`/api/auth/enter?token=${TOKEN}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/narnia_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const viaCookie = await t.app.request("/api/provider/status", {
      headers: { Cookie: cookie.split(";")[0] as string },
    });
    expect(viaCookie.status).toBe(200);
    const bad = await t.app.request("/api/auth/enter?token=errado", { redirect: "manual" });
    expect(bad.status).toBe(401);
  });

  it("token na query string NÃO autentica rotas comuns (só a rota de entrada)", async () => {
    t = makeTestApp();
    expect((await t.app.request(`/api/provider/status?token=${TOKEN}`)).status).toBe(401);
  });
});
