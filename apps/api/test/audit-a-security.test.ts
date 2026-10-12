import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EventBus } from "../src/events";
import { allowedHostsFromEnv, hostAllowed } from "../src/hosts";
import { attachWebSocket } from "../src/ws";
import { makeTestApp, type TestApp } from "./helpers";

/** Auditoria pós-F04 · bloco A (2026-10-12): desvio do token por percent-encoding e DNS rebinding. */
describe("auditoria A · token e host", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("caminho com percent-encoding não escapa do token (/api e /mcp)", async () => {
    t = makeTestApp();
    for (const path of ["/%61pi/profiles", "/api/%70rofiles", "/%61%70%69/profiles"])
      expect((await t.app.request(path)).status, path).toBe(401);
    const mcp = await t.app.request("/%6Dcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(401);
    // com o token, o mesmo caminho codificado continua funcionando
    expect((await t.api("/%61pi/profiles")).status).toBe(200);
  });

  it("caminho com percent-encoding inválido é recusado", async () => {
    t = makeTestApp();
    expect((await t.app.request("/%E0%A4%A/api/profiles")).status).toBe(400);
  });

  it("Host fora da lista (DNS rebinding) recebe 403 em /api e /mcp, mesmo com token", async () => {
    t = makeTestApp();
    const evil = await t.api("/api/profiles", { headers: { host: "evil.example.com" } });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toMatchObject({ error: { code: "forbidden_host" } });
    const mcp = await t.api("/mcp", {
      method: "POST",
      headers: {
        host: "rebind.attacker.io:3100",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(403);
    for (const host of ["127.0.0.1:3100", "localhost:5173", "[::1]:3100", "api:3100", "web"])
      expect((await t.api("/api/profiles", { headers: { host } })).status, host).toBe(200);
    expect(
      (await t.app.request("/api/health", { headers: { host: "evil.example.com" } })).status,
    ).toBe(403);
  });

  it("lista de hosts: padrões, host do NARNIA_PUBLIC_URL e NARNIA_ALLOWED_HOSTS", () => {
    const hosts = allowedHostsFromEnv({
      NARNIA_PUBLIC_URL: "http://meu-host.lan:8080",
      NARNIA_ALLOWED_HOSTS: "abc.trycloudflare.com, OUTRO.local ",
    });
    for (const h of [
      "localhost",
      "127.0.0.1",
      "::1",
      "api",
      "web",
      "meu-host.lan",
      "abc.trycloudflare.com",
      "outro.local",
    ])
      expect(hosts.has(h), h).toBe(true);
    expect(hostAllowed("ABC.trycloudflare.com:443", hosts)).toBe(true);
    expect(hostAllowed("[::1]:3100", hosts)).toBe(true);
    expect(hostAllowed("evil.com", hosts)).toBe(false);
    expect(hostAllowed("127.0.0.1.evil.com", hosts)).toBe(false);
    // sem Host (HTTP/1.0, chamadas em memória): não é um navegador, não há rebinding
    expect(hostAllowed(undefined, hosts)).toBe(true);
  });
});

describe("auditoria A · /ws recusa Host fora da lista", () => {
  let server: ReturnType<typeof createServer> | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  it("upgrade com Host estranho é derrubado; com Host local conecta", async () => {
    server = createServer((_req, res) => res.end("ok"));
    attachWebSocket({
      server,
      bus: new EventBus(),
      token: "tk",
      allowedHosts: new Set(["127.0.0.1"]),
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    const evil = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tk`, {
      headers: { host: "evil.example.com" },
    });
    const outcome = await new Promise<string>((r) => {
      evil.once("open", () => r("open"));
      evil.once("error", () => r("error"));
    });
    expect(outcome).toBe("error");
    const ok = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tk`);
    await new Promise<void>((r) => ok.once("open", () => r()));
    ok.close();
  });
});
