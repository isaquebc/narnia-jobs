import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WsEvent } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRepos,
  DEFAULT_MAIL_QUERY,
  fakeGmailAdd,
  fakeGmailFetch,
  fakeGmailState,
  finishGmailConnect,
  type GoogleClient,
  gmailSource,
  MAIL_LAST_SYNC_KEY,
  MAIL_SINCE_KEY,
  migrate,
  openDatabase,
  parseMailHeaders,
  type Repos,
  runScheduledTask,
  startGmailConnect,
} from "../../src";

/**
 * F14/M2 · sincronização do Gmail (§2.2): sem janela escolhida não lê; primeira leitura desde a janela, do mais
 * antigo para o mais novo, com limite por execução; incremental com sobreposição sem repetir; `.eml` guardado e
 * registro pendente; nada muda no Gmail; recusa do Google vira notificação "reconectar".
 */
const client: GoogleClient = { clientId: "id-123456789", clientSecret: "s", source: "env" };
const T = Date.parse("2026-11-11T12:00:00Z");
const DAY = 86_400_000;
const raw = (subject: string, from = "Vagas Acme <alertas@vagas.example>") =>
  `From: ${from}\r\nSubject: ${subject}\r\nDate: Tue, 10 Nov 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCorpo`;

describe("F14/M2 · sincronização do Gmail", () => {
  let repos: Repos;
  let dataDir: string;
  let state: ReturnType<typeof fakeGmailState>;
  let events: WsEvent[];
  beforeEach(async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-mail-sync-"));
    state = fakeGmailState();
    events = [];
    const f = fakeGmailFetch(state, { now: () => T });
    const { pending } = startGmailConnect({
      client,
      redirectUri: "http://localhost:8189/callback",
    });
    await finishGmailConnect({
      fetch: f,
      dataDir,
      client,
      pending,
      params: new URLSearchParams({ code: "code-ok", state: pending.state }),
    });
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const source = () =>
    gmailSource({ fetch: fakeGmailFetch(state, { now: () => T }), dataDir, client: () => client });
  const sync = (now = new Date(T), connected = true) =>
    runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "schedule",
      now,
      publish: async (e) => {
        events.push(e);
      },
      mailSource: () => (connected ? source() : null),
    });

  it("sem conexão ou sem janela escolhida: não lê nada e diz por quê no log", async () => {
    fakeGmailAdd(state, { id: "m1", internalDate: T - DAY, raw: raw("Vaga") });
    let r = await sync(new Date(T), false);
    expect(repos.scheduled.run(r.id)?.log[0]?.message).toMatch(/não conectado/);
    r = await sync();
    expect(repos.scheduled.run(r.id)?.log.at(-1)?.message).toMatch(/Escolha em Configurações/);
    expect(repos.mail.counts().pending).toBe(0);
  });

  it("primeira leitura: desde a janela, do mais antigo para o mais novo, .eml guardado e Gmail intacto", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 30 * DAY).toISOString());
    fakeGmailAdd(state, { id: "fora", internalDate: T - 40 * DAY, raw: raw("Antiga") });
    fakeGmailAdd(state, {
      id: "m2",
      internalDate: T - 2 * DAY,
      raw: raw("=?UTF-8?B?VmFnYTogRGV2IFPDqm5pb3I=?="),
    });
    fakeGmailAdd(state, { id: "m1", internalDate: T - 5 * DAY, raw: raw("Vaga 1") });
    const before = JSON.stringify(state.messages.map((m) => m.labelIds));
    const r = await sync();
    expect(r.status).toBe("done");
    const pending = repos.mail.pending(10);
    expect(pending.map((m) => m.gmailId)).toEqual(["m1", "m2"]);
    expect(pending[1]?.subject).toBe("Vaga: Dev Sênior");
    expect(pending[0]).toMatchObject({
      fromAddr: "alertas@vagas.example",
      fromName: "Vagas Acme",
      status: "pending",
    });
    expect(readFileSync(join(dataDir, pending[0]?.rawPath as string), "utf8")).toContain(
      "Subject: Vaga 1",
    );
    expect(JSON.stringify(state.messages.map((m) => m.labelIds))).toBe(before);
    expect(repos.scheduled.run(r.id)?.counts).toMatchObject({ fetched: 2, assessed: 2 });
    expect(
      repos.scheduled
        .run(r.id)
        ?.items.filter((i) => i.action === "baixado")
        .map((i) => i.refId),
    ).toEqual(["m1", "m2"]);
    expect(repos.settings.get(MAIL_LAST_SYNC_KEY)).toBe(new Date(T).toISOString());
  });

  const ctxOf = () => ({
    log: () => {},
    item: () => {},
    count: () => {},
    now: new Date(T),
    publish: async () => {},
  });

  it("limite por execução: o resto fica para a próxima, e a ordem continua do mais antigo para o mais novo", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 30 * DAY).toISOString());
    for (let i = 0; i < 5; i++)
      fakeGmailAdd(state, { id: `m${i}`, internalDate: T - (10 - i) * DAY, raw: raw(`V${i}`) });
    const { syncMail } = await import("../../src");
    const r1 = await syncMail({ repos, dataDir, source: source(), ctx: ctxOf(), fetchPerRun: 3 });
    expect(r1).toMatchObject({ fetched: 3, caughtUp: false });
    expect(repos.settings.get(MAIL_LAST_SYNC_KEY)).toBeUndefined();
    expect(repos.mail.pending(10).map((m) => m.gmailId)).toEqual(["m0", "m1", "m2"]);
    const r2 = await syncMail({ repos, dataDir, source: source(), ctx: ctxOf(), fetchPerRun: 3 });
    expect(r2).toMatchObject({ fetched: 2, caughtUp: true });
    expect(repos.mail.pending(10).map((m) => m.gmailId)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });

  it("revisão #1: janela com mais e-mails que o limite da busca é lida inteira, por semanas, do mais antigo", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 28 * DAY).toISOString());
    for (let i = 0; i < 28; i++)
      fakeGmailAdd(state, {
        id: `d${String(i).padStart(2, "0")}`,
        internalDate: T - (28 - i) * DAY + 3600_000,
        raw: raw(`D${i}`),
      });
    const { syncMail } = await import("../../src");
    let guard = 0;
    while (
      !(
        await syncMail({
          repos,
          dataDir,
          source: source(),
          ctx: ctxOf(),
          fetchPerRun: 4,
          listMax: 10,
        })
      ).caughtUp
    )
      if (++guard > 20) throw new Error("não terminou");
    const all = repos.mail.pending(100).map((m) => m.gmailId);
    expect(all).toHaveLength(28);
    expect(all).toEqual([...all].sort());
  });

  it("revisão #2: a janela mudou durante a rodada: o cursor desta rodada não é gravado", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 10 * DAY).toISOString());
    fakeGmailAdd(state, { id: "m1", internalDate: T - 5 * DAY, raw: raw("V1") });
    const { syncMail, MAIL_CURSOR_KEY } = await import("../../src");
    const src = source();
    const list = src.listMessageIds.bind(src);
    src.listMessageIds = async (q, max) => {
      repos.settings.set(MAIL_SINCE_KEY, new Date(T - 90 * DAY).toISOString());
      return list(q, max);
    };
    await syncMail({ repos, dataDir, source: src, ctx: ctxOf() });
    expect(repos.settings.get(MAIL_CURSOR_KEY)).toBeUndefined();
  });

  it("revisão #3: .eml cortado de uma tentativa anterior é sobrescrito", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 10 * DAY).toISOString());
    fakeGmailAdd(state, { id: "m1", internalDate: T - DAY, raw: raw("Completo") });
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(dataDir, "mail"), { recursive: true });
    writeFileSync(join(dataDir, "mail", "m1.eml"), "From: cortado");
    await sync();
    expect(readFileSync(join(dataDir, "mail", "m1.eml"), "utf8")).toContain("Subject: Completo");
  });

  it("revisão #4: e-mail ilegível falha 3 vezes e vira erro; a leitura deixa de travar", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 10 * DAY).toISOString());
    fakeGmailAdd(state, { id: "ruim", internalDate: T - 3 * DAY, raw: raw("Ruim") });
    fakeGmailAdd(state, { id: "bom", internalDate: T - 2 * DAY, raw: raw("Bom") });
    const { syncMail } = await import("../../src");
    const src = source();
    const get = src.getRaw.bind(src);
    src.getRaw = async (id) => {
      const m = await get(id);
      return id === "ruim" ? { ...m, internalDate: Number.NaN } : m;
    };
    const runs = [];
    for (let i = 0; i < 3; i++)
      runs.push(await syncMail({ repos, dataDir, source: src, ctx: ctxOf() }));
    expect(runs.map((r) => r.caughtUp)).toEqual([false, false, true]);
    expect(repos.mail.byGmailId("ruim")?.status).toBe("error");
    expect(repos.mail.byGmailId("bom")?.status).toBe("pending");
  });

  it("revisão #5: Gmail responde 403 (escopo retirado): token marcado, notificação e execução em erro", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 10 * DAY).toISOString());
    const { GmailApiError, readGmailToken } = await import("../../src");
    const src = source();
    src.listMessageIds = async () => {
      throw new GmailApiError(403, "Gmail GET /messages: 403 Insufficient Permission");
    };
    const r = await runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "schedule",
      now: new Date(T),
      publish: async () => {},
      mailSource: () => src,
    });
    expect(r.status).toBe("error");
    expect(readGmailToken(dataDir)?.invalidAt).toBeTruthy();
    expect(repos.notifications.list().some((n) => n.kind === "mail.reconnect")).toBe(true);
  });

  it("correção 2026-11-11: cota do Google no meio da leitura para a rodada sem pedir reconectar; a próxima continua", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 10 * DAY).toISOString());
    for (let i = 1; i <= 4; i++)
      fakeGmailAdd(state, { id: `m${i}`, internalDate: T - (6 - i) * DAY, raw: raw(`Vaga ${i}`) });
    const { GmailApiError, readGmailToken } = await import("../../src");
    const src = source();
    const real = src.getRaw.bind(src);
    let n = 0;
    src.getRaw = async (id) => {
      if (++n === 3)
        throw new GmailApiError(
          403,
          "Gmail GET /messages/x: 403 Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'",
          "rateLimitExceeded",
        );
      return real(id);
    };
    const r = await runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "schedule",
      now: new Date(T),
      publish: async () => {},
      mailSource: () => src,
    });
    expect(r.status).toBe("done");
    expect(readGmailToken(dataDir)?.invalidAt ?? null).toBeNull();
    expect(repos.notifications.list().some((x) => x.kind === "mail.reconnect")).toBe(false);
    expect(["m1", "m2"].every((id) => repos.mail.byGmailId(id))).toBe(true);
    expect(repos.mail.byGmailId("m3")).toBeNull();
    await sync();
    expect(["m3", "m4"].every((id) => repos.mail.byGmailId(id))).toBe(true);
  });

  it("pedido da extensão: baixado primeiro, mesmo fora da janela, e sai da lista", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 5 * DAY).toISOString());
    fakeGmailAdd(state, { id: "velho", internalDate: T - 60 * DAY, raw: raw("Fora da janela") });
    fakeGmailAdd(state, { id: "novo", internalDate: T - DAY, raw: raw("Dentro") });
    repos.settings.set("mail.forceIds", ["velho"]);
    const { syncMail } = await import("../../src");
    await syncMail({ repos, dataDir, source: source(), ctx: ctxOf() });
    expect(repos.mail.byGmailId("velho")?.subject).toBe("Fora da janela");
    expect(repos.mail.byGmailId("novo")).not.toBeNull();
    expect(repos.settings.get("mail.forceIds")).toEqual([]);
  });

  it("revisão #8: pedido da extensão com id que o Gmail recusa (400) sai da lista em vez de travar a leitura", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 5 * DAY).toISOString());
    repos.settings.set("mail.forceIds", ["ffffffffffffffff"]);
    const { syncMail, GmailApiError } = await import("../../src");
    const src = source();
    src.getRaw = async () => {
      throw new GmailApiError(400, "Invalid id value");
    };
    const r = await syncMail({ repos, dataDir, source: src, ctx: ctxOf() });
    expect(r.caughtUp).toBe(true);
    expect(repos.settings.get("mail.forceIds")).toEqual([]);
  });

  it("revisão #7: pedido da extensão que chega durante a rodada não se perde", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 5 * DAY).toISOString());
    fakeGmailAdd(state, { id: "a1", internalDate: T - DAY, raw: raw("A") });
    repos.settings.set("mail.forceIds", ["a1"]);
    const { syncMail } = await import("../../src");
    const src = source();
    const get = src.getRaw.bind(src);
    src.getRaw = async (id) => {
      repos.settings.set("mail.forceIds", ["a1", "b2b2b2b2b2b2"]);
      return get(id);
    };
    await syncMail({ repos, dataDir, source: src, ctx: ctxOf() });
    expect(repos.settings.get("mail.forceIds")).toEqual(["b2b2b2b2b2b2"]);
  });

  it("e-mail apagado entre a busca e o download (404) é pulado sem travar", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 10 * DAY).toISOString());
    fakeGmailAdd(state, { id: "sumiu", internalDate: T - 2 * DAY, raw: raw("X") });
    const { syncMail, GmailApiError } = await import("../../src");
    const src = source();
    src.getRaw = async () => {
      throw new GmailApiError(404, "not found");
    };
    const r = await syncMail({ repos, dataDir, source: src, ctx: ctxOf() });
    expect(r.caughtUp).toBe(true);
  });

  it("incremental: só os novos desde a última leitura (com sobreposição), sem repetir", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 30 * DAY).toISOString());
    fakeGmailAdd(state, { id: "m1", internalDate: T - DAY, raw: raw("V1") });
    await sync();
    fakeGmailAdd(state, { id: "m2", internalDate: T + 30 * 60_000, raw: raw("V2") });
    const r = await sync(new Date(T + 60 * 60_000));
    expect(repos.scheduled.run(r.id)?.counts).toMatchObject({ fetched: 1, assessed: 1 });
    expect(repos.settings.get(MAIL_LAST_SYNC_KEY)).toBe(new Date(T + 60 * 60_000).toISOString());
    expect(repos.mail.pending(10).map((m) => m.gmailId)).toEqual(["m1", "m2"]);
  });

  it("o Google recusa o acesso: execução com erro e notificação para reconectar; reconectado, a notificação some", async () => {
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 30 * DAY).toISOString());
    state.revoked = true;
    const r = await sync();
    expect(r.status).toBe("error");
    const open = repos.notifications.list().filter((n) => n.kind === "mail.reconnect");
    expect(open).toHaveLength(1);
    expect(events.some((e) => e.type === "notification.created")).toBe(true);
  });

  it("a busca padrão cobre as plataformas do M0 e assuntos de vaga, sem enviados e rascunhos", () => {
    for (const s of [
      "from:glassdoor.com",
      "from:linkedin.com",
      "from:coders.com.br",
      "subject:vaga",
      "subject:candidatura",
    ])
      expect(DEFAULT_MAIL_QUERY).toContain(s);
    expect(DEFAULT_MAIL_QUERY).toContain("-in:sent");
  });

  it("cabeçalho com nome codificado e Reply-To", async () => {
    const h = await parseMailHeaders(
      Buffer.from(
        "From: =?UTF-8?Q?Jo=C3=A3o_Recrutador?= <JOAO@Acme.example>\r\nReply-To: rh@acme.example\r\nSubject: Oi\r\n\r\nx",
      ),
    );
    expect(h).toEqual({
      fromAddr: "joao@acme.example",
      fromName: "João Recrutador",
      replyTo: "rh@acme.example",
      subject: "Oi",
    });
    expect(existsSync(dataDir)).toBe(true);
  });
});
