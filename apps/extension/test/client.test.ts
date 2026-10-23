import { describe, expect, it } from "vitest";
import { normalizeInstanceUrl, pairWithCode, testConnection } from "../src/client";
import { buildManifest } from "../src/manifest";

/** F12/M1 · extensão: endereço da instância, pareamento, teste da conexão e permissões mínimas do manifesto. */
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("F12/M1 · endereço da instância", () => {
  it("aceita o que a pessoa cola e devolve só a origem", () => {
    expect(normalizeInstanceUrl("127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(normalizeInstanceUrl(" http://localhost:3100/configuracoes ")).toBe(
      "http://localhost:3100",
    );
  });
  it("recusa endereço fora do computador e esquema estranho", () => {
    expect(normalizeInstanceUrl("https://example.com")).toBeNull();
    expect(normalizeInstanceUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeInstanceUrl("")).toBeNull();
  });
  it("host extra só quando o build do e2e passa", () => {
    expect(normalizeInstanceUrl("http://web")).toBeNull();
    expect(normalizeInstanceUrl("http://web", ["web"])).toBe("http://web");
  });
});

describe("F12/M1 · pareamento e conexão", () => {
  it("troca o código pelo token", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const r = await pairWithCode(
      (url, init) => {
        calls.push([url, init]);
        return json(200, { token: "nxd_abc", device: { name: "Chrome A" } });
      },
      "http://127.0.0.1:3100",
      "k7qm-3xpa",
      "Chrome A",
    );
    expect(r).toEqual({ ok: true, token: "nxd_abc", deviceName: "Chrome A" });
    expect(calls[0]?.[0]).toBe("http://127.0.0.1:3100/api/extension/pair");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      code: "k7qm-3xpa",
      name: "Chrome A",
    });
  });

  it("código errado, muitas tentativas e narnia fora do ar viram mensagens claras", async () => {
    const bad = await pairWithCode(
      () => json(400, { error: { code: "invalid_code", message: "Código inválido ou vencido." } }),
      "http://127.0.0.1:3100",
      "x",
      "c",
    );
    expect(bad).toMatchObject({ ok: false, reason: "invalid_code" });
    const many = await pairWithCode(
      () => json(429, { error: { code: "too_many_attempts", message: "espere" } }),
      "http://127.0.0.1:3100",
      "x",
      "c",
    );
    expect(many).toMatchObject({ ok: false, reason: "too_many_attempts" });
    const off = await pairWithCode(
      () => Promise.reject(new TypeError("Failed to fetch")),
      "http://127.0.0.1:3100",
      "x",
      "c",
    );
    expect(off).toMatchObject({ ok: false, reason: "offline" });
    expect(off.ok ? "" : off.message).toContain("http://127.0.0.1:3100");
  });

  it("testa a conexão; dispositivo revogado pede novo pareamento", async () => {
    const ok = await testConnection(
      (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer nxd_abc");
        return json(200, { device: { name: "Chrome A" }, version: "1.2.3" });
      },
      "http://127.0.0.1:3100",
      "nxd_abc",
    );
    expect(ok).toEqual({ ok: true, deviceName: "Chrome A", version: "1.2.3" });
    const revoked = await testConnection(() => json(401, {}), "http://127.0.0.1:3100", "nxd_abc");
    expect(revoked).toMatchObject({ ok: false, reason: "unauthorized" });
  });
});

describe("F12/M1 · manifesto", () => {
  it("MV3 com permissões mínimas: guardar o pareamento, falar com o narnia local e ler a aba no clique", () => {
    const m = buildManifest("0.1.0");
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(["storage", "activeTab", "scripting"]);
    expect(m.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
    expect(JSON.stringify(m)).not.toContain("<all_urls>");
    // F12/M3: quadro de outro site só com a permissão pedida na hora
    expect(m.optional_host_permissions).toEqual(["https://*/*"]);
    // F12-15: menu no clique; F12-14/F12-17: ponte só nas páginas do narnia
    expect(m.action.default_popup).toBe("popup.html");
    expect(m.content_scripts).toEqual([
      {
        matches: ["http://127.0.0.1/*", "http://localhost/*"],
        js: ["page-bridge.js"],
        run_at: "document_start",
      },
    ]);
    expect(buildManifest("0.1.0", ["web"]).host_permissions).toContain("http://web/*");
  });
});
