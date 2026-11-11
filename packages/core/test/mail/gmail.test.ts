import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGmailAuthUrl,
  disconnectGmail,
  fakeGmailAdd,
  fakeGmailFetch,
  fakeGmailState,
  finishGmailConnect,
  GMAIL_SCOPE,
  type GoogleClient,
  gmailSource,
  gmailStatus,
  MAIL_LABEL,
  MAIL_SUSPECT_LABEL,
  MailAuthError,
  oauthCallbackPort,
  oauthRedirectUri,
  readGmailToken,
  resolveGoogleClient,
  saveGoogleClient,
  startGmailConnect,
} from "../../src";

/**
 * F14/M1 · conexão com o Gmail (F14-4, §2.0.3): cliente OAuth do ambiente ou de Configurações, PKCE, troca do código,
 * etiquetas criadas na conexão, token em `secrets/` (0600), renovação com recusa → "reconectar", desconectar revoga.
 * A fonte REST é exercitada contra o Gmail falso (busca, raw, histórico com expiração, batchModify, anexo).
 */
const client: GoogleClient = {
  clientId: "123-abc.apps.googleusercontent.com",
  clientSecret: "s3cr3t",
  source: "env",
};
const redirect = oauthRedirectUri(8189);

describe("F14/M1 · OAuth e conexão do Gmail", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "narnia-gmail-"));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("cliente: o do ambiente vence; sem ele, o salvo em Configurações; sem nenhum, null", () => {
    expect(resolveGoogleClient({}, dataDir)).toBeNull();
    saveGoogleClient(dataDir, { clientId: " id-salvo ", clientSecret: "seg" });
    expect(resolveGoogleClient({}, dataDir)).toEqual({
      clientId: "id-salvo",
      clientSecret: "seg",
      source: "settings",
    });
    expect(
      resolveGoogleClient({ GOOGLE_CLIENT_ID: "id-env", GOOGLE_CLIENT_SECRET: "x" }, dataDir)
        ?.source,
    ).toBe("env");
    expect(
      resolveGoogleClient({ GOOGLE_CLIENT_ID: "id-env", GOOGLE_CLIENT_SECRET: "" }, dataDir)
        ?.source,
    ).toBe("settings");
    const st = statSync(join(dataDir, "secrets", "google-oauth-client.json"));
    expect(st.mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, "secrets")).mode & 0o777).toBe(0o700);
  });

  it("porta e endereço de retorno: NARNIA_OAUTH_PORT ou 8089", () => {
    expect(oauthCallbackPort({ NARNIA_OAUTH_PORT: "8189" })).toBe(8189);
    expect(oauthCallbackPort({ NARNIA_OAUTH_PORT: "x" })).toBe(8089);
    expect(oauthRedirectUri(8089)).toBe("http://localhost:8089/callback");
  });

  it("URL de login: escopo gmail.modify, offline, consentimento, PKCE S256 e state", () => {
    const s = buildGmailAuthUrl({ clientId: client.clientId, redirectUri: redirect });
    const u = new URL(s.url);
    expect(u.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(redirect);
    expect(u.searchParams.get("state")).toBe(s.state);
    expect(s.verifier.length).toBeGreaterThan(40);
  });

  it("conectar: troca o código, lê o e-mail, cria as duas etiquetas e grava o token (0600); status conectado", async () => {
    const state = fakeGmailState({ email: "pessoa@example.com" });
    const f = fakeGmailFetch(state);
    const { pending } = startGmailConnect({ client, redirectUri: redirect, now: 0 });
    const r = await finishGmailConnect({
      fetch: f,
      dataDir,
      client,
      pending,
      params: new URLSearchParams({ code: "code-ok", state: pending.state }),
      now: 1,
    });
    expect(r.email).toBe("pessoa@example.com");
    expect(state.labels.map((l) => l.name)).toEqual(
      expect.arrayContaining([MAIL_LABEL, MAIL_SUSPECT_LABEL]),
    );
    expect(readGmailToken(dataDir)?.refreshToken).toBe("refresh-ok");
    expect(statSync(join(dataDir, "secrets", "gmail-token.json")).mode & 0o777).toBe(0o600);
    expect(gmailStatus(dataDir, client)).toMatchObject({
      status: "connected",
      email: "pessoa@example.com",
      clientSource: "env",
    });
  });

  it("retorno inválido: state de outra tentativa, expirado, acesso negado e código recusado", async () => {
    const f = fakeGmailFetch(fakeGmailState());
    const { pending } = startGmailConnect({ client, redirectUri: redirect, now: 0, ttlMs: 1000 });
    const finish = (params: Record<string, string>, now = 1) =>
      finishGmailConnect({
        fetch: f,
        dataDir,
        client,
        pending,
        params: new URLSearchParams(params),
        now,
      });
    await expect(finish({ code: "code-ok", state: "outro" })).rejects.toThrow(/Conectar de novo/);
    await expect(finish({ code: "code-ok", state: pending.state }, 5000)).rejects.toThrow(
      MailAuthError,
    );
    await expect(finish({ error: "access_denied", state: pending.state })).rejects.toThrow(
      /negado/,
    );
    await expect(finish({ code: "errado", state: pending.state })).rejects.toThrow(/recusou/);
    expect(existsSync(join(dataDir, "secrets", "gmail-token.json"))).toBe(false);
  });

  it("status: sem cliente, desconectado e reconectar quando o Google recusa o refresh", async () => {
    expect(gmailStatus(dataDir, null).status).toBe("not_configured");
    expect(gmailStatus(dataDir, client).status).toBe("disconnected");
    const state = fakeGmailState();
    const f = fakeGmailFetch(state);
    const { pending } = startGmailConnect({ client, redirectUri: redirect });
    await finishGmailConnect({
      fetch: f,
      dataDir,
      client,
      pending,
      params: new URLSearchParams({ code: "code-ok", state: pending.state }),
    });
    state.revoked = true;
    const source = gmailSource({ fetch: f, dataDir, client: () => client });
    await expect(source.profile()).rejects.toMatchObject({ code: "needs_reconnect" });
    expect(gmailStatus(dataDir, client)).toMatchObject({
      status: "needs_reconnect",
      email: "pessoa@example.com",
    });
  });

  it("desconectar revoga no Google e apaga o token", async () => {
    const state = fakeGmailState();
    const f = fakeGmailFetch(state);
    const { pending } = startGmailConnect({ client, redirectUri: redirect });
    await finishGmailConnect({
      fetch: f,
      dataDir,
      client,
      pending,
      params: new URLSearchParams({ code: "code-ok", state: pending.state }),
    });
    await disconnectGmail({ fetch: f, dataDir });
    expect(state.revoked).toBe(true);
    expect(readGmailToken(dataDir)).toBeNull();
    expect(gmailStatus(dataDir, client).status).toBe("disconnected");
  });
});

describe("F14/M1 · fonte REST do Gmail (contra o Gmail falso)", () => {
  const raw = (subject: string) =>
    `From: Vagas <alertas@vagas.example>\r\nSubject: ${subject}\r\nDate: Tue, 10 Nov 2026 10:00:00 +0000\r\n\r\ncorpo`;
  const T = Date.parse("2026-11-11T12:00:00Z");

  async function connected() {
    const dataDir = mkdtempSync(join(tmpdir(), "narnia-gmail-src-"));
    const state = fakeGmailState();
    const f = fakeGmailFetch(state, { now: () => T });
    const { pending } = startGmailConnect({ client, redirectUri: redirect });
    await finishGmailConnect({
      fetch: f,
      dataDir,
      client,
      pending,
      params: new URLSearchParams({ code: "code-ok", state: pending.state }),
    });
    return { dataDir, state, source: gmailSource({ fetch: f, dataDir, client: () => client }) };
  }

  it("busca por data, raw, etiqueta e lido, anexo e histórico (com expiração)", async () => {
    const { dataDir, state, source } = await connected();
    try {
      fakeGmailAdd(state, { id: "m-velho", internalDate: T - 40 * 86_400_000, raw: raw("velho") });
      const base = state.historyId;
      fakeGmailAdd(state, {
        id: "m1",
        internalDate: T - 86_400_000,
        raw: raw("Vaga nova"),
        attachments: [
          { id: "a1", filename: "convite.ics", mimeType: "text/calendar", data: "BEGIN:VCALENDAR" },
        ],
      });
      expect(await source.listMessageIds("newer_than:30d", 100)).toEqual(["m1"]);
      expect(
        await source.listMessageIds(`after:${Math.floor((T - 50 * 86_400_000) / 1000)}`, 100),
      ).toEqual(["m1", "m-velho"]);
      const m = await source.getRaw("m1");
      expect(m.raw.toString()).toContain("Subject: Vaga nova");
      expect(m.labelIds).toContain("UNREAD");
      expect((await source.getAttachment("m1", "a1")).toString()).toBe("BEGIN:VCALENDAR");
      const labels = await source.ensureLabels([MAIL_LABEL]);
      await source.modify(["m1"], { add: [labels[MAIL_LABEL] as string], remove: ["UNREAD"] });
      const after = state.messages.find((x) => x.id === "m1");
      expect(after?.labelIds).toContain(labels[MAIL_LABEL]);
      expect(after?.labelIds).not.toContain("UNREAD");
      const h = await source.history(String(base));
      expect(h).toMatchObject({ messageIds: ["m1"] });
      state.minHistoryId = base + 100;
      expect(await source.history(String(base))).toEqual({ expired: true });
      expect((await source.profile()).email).toBe("pessoa@example.com");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
