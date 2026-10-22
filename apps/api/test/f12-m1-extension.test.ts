import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * F12/M1 (F12-4, F12-9) · pareamento da extensão: Configurações gera o código; a extensão troca por um token de
 * dispositivo (rota pública, com limite de tentativas) que vale para toda a API até ser revogado.
 */
describe("F12/M1 · extensão do navegador na API", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  const owner = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function pairDevice(app: TestApp, name = "Chrome do notebook") {
    const { code } = (await (
      await app.app.request("/api/extension/pairing", { method: "POST", headers: owner })
    ).json()) as { code: string };
    const res = await app.app.request("/api/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    return { res, body: (await res.json()) as { token: string; device: { id: string } } };
  }

  it("Configurações gera o código; a extensão pareia sem o token do dono e usa o token de dispositivo", async () => {
    t = makeTestApp();
    const gen = await t.app.request("/api/extension/pairing", { method: "POST", headers: owner });
    expect(gen.status).toBe(200);
    expect(await gen.json()).toMatchObject({ code: expect.stringMatching(/^\w{4}-\w{4}$/) });
    const { res, body } = await pairDevice(t);
    expect(res.status).toBe(200);
    expect(body.token).toMatch(/^nxd_/);
    const me = await t.app.request("/api/extension/me", { headers: bearer(body.token) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      device: { name: "Chrome do notebook" },
      version: "0.0.0-test",
    });
    // F12-9: o token de dispositivo vale para a API inteira
    expect((await t.app.request("/api/profiles", { headers: bearer(body.token) })).status).toBe(
      200,
    );
    expect(t.repos.extension.listDevices()[0]?.lastSeenAt).not.toBeNull();
  });

  it("gerar código e listar dispositivos exigem autenticação; parear não", async () => {
    t = makeTestApp();
    expect((await t.app.request("/api/extension/pairing", { method: "POST" })).status).toBe(401);
    expect((await t.app.request("/api/extension/devices")).status).toBe(401);
    const bad = await t.app.request("/api/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "AAAA-BBBB", name: "x" }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_code" } });
  });

  it("lista e revoga: o token revogado deixa de valer na hora", async () => {
    t = makeTestApp();
    const { body } = await pairDevice(t);
    const list = await t.app.request("/api/extension/devices", { headers: owner });
    expect(await list.json()).toMatchObject({
      devices: [{ id: body.device.id, name: "Chrome do notebook" }],
    });
    const del = await t.app.request(`/api/extension/devices/${body.device.id}`, {
      method: "DELETE",
      headers: owner,
    });
    expect(del.status).toBe(204);
    expect((await t.app.request("/api/extension/me", { headers: bearer(body.token) })).status).toBe(
      401,
    );
    expect(
      (
        await t.app.request(`/api/extension/devices/${body.device.id}`, {
          method: "DELETE",
          headers: owner,
        })
      ).status,
    ).toBe(404);
  });

  it("muitas tentativas erradas seguidas: 429 até passar um minuto", async () => {
    t = makeTestApp();
    const attempt = () =>
      t?.app.request("/api/extension/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "ZZZZ-ZZZZ", name: "x" }),
      });
    for (let i = 0; i < 10; i++) expect((await attempt())?.status).toBe(400);
    expect((await attempt())?.status).toBe(429);
  });

  it("token de dispositivo no Bearer conta o uso mesmo com o cookie do dono no mesmo navegador", async () => {
    t = makeTestApp();
    const { body } = await pairDevice(t);
    const me = await t.app.request("/api/extension/me", {
      headers: { ...bearer(body.token), cookie: `narnia_token=${TOKEN}` },
    });
    expect(me.status).toBe(200);
    expect(t.repos.extension.listDevices()[0]?.lastSeenAt).not.toBeNull();
  });

  it("token de dispositivo revogado no Bearer dá 401 mesmo com o cookie do dono (a extensão sabe que caiu)", async () => {
    t = makeTestApp();
    const { body } = await pairDevice(t);
    t.repos.extension.revoke(body.device.id);
    const me = await t.app.request("/api/extension/me", {
      headers: { ...bearer(body.token), cookie: `narnia_token=${TOKEN}` },
    });
    expect(me.status).toBe(401);
    const page = await t.app.request("/api/profiles", {
      headers: { cookie: `narnia_token=${TOKEN}` },
    });
    expect(page.status).toBe(200);
  });

  it("/me com o token do dono responde sem dispositivo (a página de opções testa a conexão)", async () => {
    t = makeTestApp();
    const me = await t.app.request("/api/extension/me", { headers: owner });
    expect(await me.json()).toMatchObject({ device: null });
  });
});
