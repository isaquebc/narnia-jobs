import { describe, expect, it } from "vitest";
import { disconnect } from "../src/client";
import { optionsView } from "../src/options-view";

/**
 * F12/M1 (testes do dono, 2026-10-23) · página de opções: pareada, mostra o estado da conexão em vez do formulário;
 * "Testar conexão" sempre dá retorno visível; "Desconectar" remove o dispositivo no narnia também.
 */
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
const at = new Date(2026, 9, 23, 14, 5, 9);
const paired = { instance: "http://127.0.0.1:5173", token: "nxd_abc", deviceName: "Chrome A" };

describe("F12/M1 · visão da página de opções", () => {
  it("sem token: formulário de pareamento", () => {
    expect(optionsView({}, null, at)).toEqual({
      mode: "pair",
      tone: "",
      text: "Ainda não pareado.",
    });
  });

  it("pareada e conectada: estado da conexão com a hora da verificação, sem o formulário", () => {
    const v = optionsView(paired, { ok: true, deviceName: "Chrome A", version: "0.1.0" }, at);
    expect(v.mode).toBe("connected");
    expect(v.tone).toBe("ok");
    expect(v.text).toBe('Conectado como "Chrome A" (narnia 0.1.0). Verificado às 14:05:09.');
  });

  it("narnia fora do ar: continua pareada, com o erro e a hora", () => {
    const v = optionsView(paired, { ok: false, reason: "offline", message: "Sem conexão." }, at);
    expect(v).toEqual({
      mode: "connected",
      tone: "error",
      text: "Sem conexão. Verificado às 14:05:09.",
    });
  });

  it("dispositivo revogado no narnia: volta ao formulário com o aviso", () => {
    const v = optionsView(
      paired,
      { ok: false, reason: "unauthorized", message: "Foi desconectado no narnia." },
      at,
    );
    expect(v).toEqual({ mode: "pair", tone: "error", text: "Foi desconectado no narnia." });
  });
});

describe("F12/M1 · desconectar", () => {
  it("descobre o próprio dispositivo e o remove no narnia", async () => {
    const calls: string[] = [];
    const r = await disconnect(
      (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        return url.endsWith("/me")
          ? json(200, { device: { id: "d1", name: "Chrome A" }, version: "0.1.0" })
          : json(204, null);
      },
      paired.instance,
      paired.token,
    );
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual([
      "GET http://127.0.0.1:5173/api/extension/me",
      "DELETE http://127.0.0.1:5173/api/extension/devices/d1",
    ]);
  });

  it("já revogado conta como desconectado; narnia fora do ar avisa que ficou só neste navegador", async () => {
    expect(await disconnect(() => json(401, {}), paired.instance, paired.token)).toEqual({
      ok: true,
    });
    const off = await disconnect(
      () => Promise.reject(new TypeError("Failed to fetch")),
      paired.instance,
      paired.token,
    );
    expect(off).toMatchObject({ ok: false });
    expect(off.ok ? "" : off.message).toContain("Configurações");
  });
});
