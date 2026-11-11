import { fakeGmailFetch, fakeGmailState, readGmailToken } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import type { CallbackResult } from "../src/routes/gmail";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14/M1 · Configurações › Gmail na API (F14-4): status, cliente OAuth salvo (segredo nunca volta; o do .env não é
 * trocado por aqui), conectar (o servidor do retorno sobe só durante o login e grava o token), erro no retorno e
 * desconectar.
 */
const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

type Status = Record<string, unknown> & {
  status: string;
  lastError: string | null;
  connecting: boolean;
  clientSource: string | null;
};
const body = async (r: Response) => (await r.json()) as Status;

function setup(env: Record<string, string> = {}) {
  const state = fakeGmailState({ email: "pessoa@example.com" });
  let handler: ((url: URL) => Promise<CallbackResult>) | null = null;
  let closed = 0;
  const t = makeTestApp({
    gmail: {
      env,
      fetch: fakeGmailFetch(state),
      port: 8189,
      listen: async (_port, h) => {
        handler = h;
        return { close: () => closed++ };
      },
    },
  });
  return {
    t,
    state,
    callback: (q: Record<string, string>) => {
      if (!handler) throw new Error("servidor do retorno não subiu");
      return handler(new URL(`http://localhost:8189/callback?${new URLSearchParams(q)}`));
    },
    closed: () => closed,
  };
}

describe("F14/M1 · /api/integrations/gmail", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("sem cliente: not_configured com o endereço de retorno; conectar dá 409", async () => {
    const s = setup();
    t = s.t;
    const r = await body(await t.api("/api/integrations/gmail"));
    expect(r).toMatchObject({
      status: "not_configured",
      redirectUri: "http://localhost:8189/callback",
      connecting: false,
    });
    expect((await t.api("/api/integrations/gmail/connect", { method: "POST" })).status).toBe(409);
  });

  it("cliente salvo em Configurações: o segredo nunca volta; apagar volta a not_configured", async () => {
    const s = setup();
    t = s.t;
    const put = await t.api(
      "/api/integrations/gmail/client",
      json("PUT", {
        clientId: "123456789-abc.apps.googleusercontent.com",
        clientSecret: "GOCSPX-segredo",
      }),
    );
    expect(put.status).toBe(200);
    const text = await put.text();
    expect(text).not.toContain("GOCSPX-segredo");
    expect(JSON.parse(text) as Status).toMatchObject({
      status: "disconnected",
      clientSource: "settings",
      clientIdHint: "123456789-ab…",
    });
    expect(
      (await body(await t.api("/api/integrations/gmail/client", { method: "DELETE" }))).status,
    ).toBe("not_configured");
  });

  it("cliente do .env: não troca nem apaga por aqui", async () => {
    const s = setup({ GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" });
    t = s.t;
    expect((await body(await t.api("/api/integrations/gmail"))).clientSource).toBe("env");
    const put = await t.api(
      "/api/integrations/gmail/client",
      json("PUT", { clientId: "outro-id-12345", clientSecret: "x-12345" }),
    );
    expect(put.status).toBe(409);
    expect((await t.api("/api/integrations/gmail/client", { method: "DELETE" })).status).toBe(409);
  });

  it("conectar: URL do Google, retorno com o código grava o token, fecha o servidor e avisa a web", async () => {
    const s = setup({ GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" });
    t = s.t;
    const r = (await (
      await t.api("/api/integrations/gmail/connect", { method: "POST" })
    ).json()) as {
      authUrl: string;
      connecting: boolean;
    };
    expect(r.connecting).toBe(true);
    const auth = new URL(r.authUrl);
    expect(auth.host).toBe("accounts.google.com");
    expect(auth.searchParams.get("redirect_uri")).toBe("http://localhost:8189/callback");
    const res = await s.callback({
      code: "code-ok",
      state: auth.searchParams.get("state") as string,
    });
    expect(res.status).toBe(200);
    expect(res.html).toContain("pessoa@example.com");
    expect(s.closed()).toBe(1);
    expect(readGmailToken(t.dataDir)?.email).toBe("pessoa@example.com");
    const st = await body(await t.api("/api/integrations/gmail"));
    expect(st).toMatchObject({
      status: "connected",
      email: "pessoa@example.com",
      connecting: false,
      lastError: null,
    });
    expect(t.events).toContainEqual({ type: "gmail.updated" });
  });

  it("retorno com acesso negado: mostra o erro, para de esperar e o status guarda o motivo", async () => {
    const s = setup({ GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" });
    t = s.t;
    const r = (await (
      await t.api("/api/integrations/gmail/connect", { method: "POST" })
    ).json()) as { authUrl: string };
    const state = new URL(r.authUrl).searchParams.get("state") as string;
    const res = await s.callback({ error: "access_denied", state });
    expect(res.status).toBe(400);
    const st = await body(await t.api("/api/integrations/gmail"));
    expect(st).toMatchObject({
      status: "disconnected",
      connecting: false,
      lastError: "Acesso negado no Google",
    });
  });

  it("porta ocupada: 409 com a explicação", async () => {
    const t0 = makeTestApp({
      gmail: {
        env: { GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" },
        listen: async () => {
          throw new Error("EADDRINUSE");
        },
      },
    });
    t = t0;
    const r = await t.api("/api/integrations/gmail/connect", { method: "POST" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("callback_port_busy");
  });

  it("desconectar revoga no Google e volta a disconnected", async () => {
    const s = setup({ GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" });
    t = s.t;
    const r = (await (
      await t.api("/api/integrations/gmail/connect", { method: "POST" })
    ).json()) as { authUrl: string };
    await s.callback({
      code: "code-ok",
      state: new URL(r.authUrl).searchParams.get("state") as string,
    });
    const d = await body(await t.api("/api/integrations/gmail", { method: "DELETE" }));
    expect(d.status).toBe("disconnected");
    expect(s.state.revoked).toBe(true);
  });
});

describe("F14/M1 · revisão: conectar sem condições de corrida", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("retorno repetido depois do sucesso (recarregar a aba) não troca de novo nem grava erro", async () => {
    const s = setup({ GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" });
    t = s.t;
    const r = (await (
      await t.api("/api/integrations/gmail/connect", { method: "POST" })
    ).json()) as {
      authUrl: string;
    };
    const q = { code: "code-ok", state: new URL(r.authUrl).searchParams.get("state") as string };
    expect((await s.callback(q)).status).toBe(200);
    const tokenCalls = s.state.calls.token;
    const again = await s.callback(q);
    expect(again.status).toBe(200);
    expect(s.state.calls.token).toBe(tokenCalls);
    expect((await body(await t.api("/api/integrations/gmail"))).lastError).toBeNull();
  });

  it("dois Conectar ao mesmo tempo: o segundo dá 409 e o primeiro segue valendo", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    t = makeTestApp({
      gmail: {
        env: { GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" },
        listen: async () => {
          await gate;
          return { close: () => {} };
        },
      },
    });
    const first = t.api("/api/integrations/gmail/connect", { method: "POST" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await t.api("/api/integrations/gmail/connect", { method: "POST" });
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect((await body(await t.api("/api/integrations/gmail"))).connecting).toBe(true);
  });
});

describe("F14/M1 · página do retorno", async () => {
  const { callbackPage } = await import("../src/routes/gmail");
  it("escapa o texto (o erro pode vir da URL)", () => {
    const html = callbackPage("Não conectou", 'Google: <script>alert("x")</script>');
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("F14/M2 · revisão #6: a notificação de reconectar some ao conectar e ao desconectar", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());
  const notify = (tt: TestApp) =>
    tt.repos.notifications.upsert({
      kind: "mail.reconnect",
      subjectKind: "mail",
      subjectId: "gmail",
      title: "x",
      actionUrl: "/configuracoes",
    });
  const open = (tt: TestApp) =>
    tt.repos.notifications.list().filter((n) => n.kind === "mail.reconnect");

  it("conectar de novo resolve", async () => {
    const s = setup({ GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" });
    t = s.t;
    notify(t);
    const r = (await (
      await t.api("/api/integrations/gmail/connect", { method: "POST" })
    ).json()) as { authUrl: string };
    await s.callback({
      code: "code-ok",
      state: new URL(r.authUrl).searchParams.get("state") as string,
    });
    expect(open(t)).toHaveLength(0);
  });

  it("desconectar resolve", async () => {
    const s = setup({ GOOGLE_CLIENT_ID: "env-id-123456789", GOOGLE_CLIENT_SECRET: "env-secret" });
    t = s.t;
    notify(t);
    await t.api("/api/integrations/gmail", { method: "DELETE" });
    expect(open(t)).toHaveLength(0);
  });
});

describe("F14/M2 · janela da primeira leitura", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());
  const put = (since: string) =>
    t.api("/api/mail/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since }),
    });

  it("sem janela: since null; escolher grava; janela maior volta a leitura ao começo; futuro e mais de um ano: 422", async () => {
    t = makeTestApp();
    const empty = (await (await t.api("/api/mail/settings")).json()) as {
      since: string | null;
      counts: { pending: number };
    };
    expect(empty.since).toBeNull();
    expect(empty.counts.pending).toBe(0);
    const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect((await put(d30)).status).toBe(200);
    t.repos.settings.set("mail.lastSyncAt", new Date().toISOString());
    const d90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const r = (await (await put(d90)).json()) as { since: string; lastSyncAt: string | null };
    expect(r.since).toBe(d90);
    expect(r.lastSyncAt).toBeNull();
    expect((await put(new Date(Date.now() + 86_400_000).toISOString())).status).toBe(422);
    expect((await put(new Date(Date.now() - 400 * 86_400_000).toISOString())).status).toBe(422);
  });
});
