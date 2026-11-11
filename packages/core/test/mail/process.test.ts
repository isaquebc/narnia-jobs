import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRepos,
  fakeGmailAdd,
  fakeGmailFetch,
  fakeGmailState,
  finishGmailConnect,
  type GoogleClient,
  gmailSource,
  MAIL_SINCE_KEY,
  MAIL_SUSPECT_LABEL,
  migrate,
  openDatabase,
  type Repos,
  runScheduledTask,
  startGmailConnect,
} from "../../src";
import { rawMail } from "./fixtures";

/**
 * F14/M3 · avaliação na tarefa `mail.sync`: risco alto vai para a quarentena com a etiqueta `narnia-jobs/suspeito` e
 * continua não lido (F14-14); fora do assunto fica intocado; o resto espera o modelo com o risco gravado; falha do
 * Gmail ao etiquetar fica para a próxima execução.
 */
const client: GoogleClient = { clientId: "id-123456789", clientSecret: "s", source: "env" };
const T = Date.parse("2026-11-11T12:00:00Z");
const DAY = 86_400_000;

describe("F14/M3 · avaliação dos e-mails baixados", () => {
  let repos: Repos;
  let dataDir: string;
  let state: ReturnType<typeof fakeGmailState>;
  beforeEach(async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-mail-proc-"));
    state = fakeGmailState();
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
    repos.settings.set(MAIL_SINCE_KEY, new Date(T - 30 * DAY).toISOString());
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const sync = (fetchImpl = fakeGmailFetch(state, { now: () => T })) =>
    runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "schedule",
      now: new Date(T),
      publish: async () => {},
      mailSource: () => gmailSource({ fetch: fetchImpl, dataDir, client: () => client }),
    });
  const add = (id: string, o: Parameters<typeof rawMail>[0], daysAgo = 2) =>
    fakeGmailAdd(state, { id, internalDate: T - daysAgo * DAY, raw: rawMail(o).toString() });

  it("quarentena, fora do assunto e para análise, cada um no seu lugar", async () => {
    add("golpe", { from: "Vagas <rh@linkedln.com>", subject: "Vaga urgente" }, 3);
    add(
      "post",
      { from: "LinkedIn <notifications-noreply@linkedin.com>", subject: "Ana comentou" },
      2,
    );
    add(
      "alerta",
      { from: "LinkedIn <jobalerts-noreply@linkedin.com>", subject: "Dev Backend: 10 vagas" },
      1,
    );
    const r = await sync();
    expect(r.status).toBe("done");
    const golpe = repos.mail.byGmailId("golpe");
    expect(golpe).toMatchObject({
      status: "quarantine",
      riskLevel: "high",
      suspectLabel: true,
      gmailSynced: false,
    });
    expect(golpe?.riskReasons.join()).toMatch(/imita linkedin/);
    const suspect = state.labels.find((l) => l.name === MAIL_SUSPECT_LABEL)?.id as string;
    const g = state.messages.find((m) => m.id === "golpe");
    expect(g?.labelIds).toContain(suspect);
    expect(g?.labelIds).toContain("UNREAD");
    expect(repos.mail.byGmailId("post")).toMatchObject({ status: "ignored", class: "ignored" });
    expect(state.messages.find((m) => m.id === "post")?.labelIds).toEqual(["INBOX", "UNREAD"]);
    expect(repos.mail.byGmailId("alerta")).toMatchObject({
      status: "pending",
      class: "candidate",
      riskLevel: "trusted",
    });
    const run = repos.scheduled.run(r.id);
    expect(run?.counts).toMatchObject({ fetched: 3, assessed: 3, quarantined: 1, ignored: 1 });
    expect(
      run?.items.find((i) => i.refId === "golpe" && i.action === "quarentena")?.detail,
    ).toMatch(/imita/);
    expect(repos.mailSenders.get("rh@linkedln.com")?.seenCount).toBe(1);
  });

  it("Gmail falhou ao etiquetar a quarentena: fica para a próxima execução", async () => {
    add("golpe", { from: "Vagas <rh@linkedln.com>", subject: "Vaga urgente" });
    const base = fakeGmailFetch(state, { now: () => T });
    const flaky: typeof fetch = async (input, init) =>
      String(input).includes("batchModify")
        ? new Response("{}", { status: 503 })
        : base(input, init);
    const r1 = await sync(flaky);
    expect(repos.mail.byGmailId("golpe")).toMatchObject({
      status: "quarantine",
      gmailSynced: false,
    });
    expect(
      repos.scheduled.run(r1.id)?.log.some((l) => /etiqueta de quarentena/.test(l.message)),
    ).toBe(true);
    await sync();
    expect(repos.mail.byGmailId("golpe")?.suspectLabel).toBe(true);
  });

  it("revisão #9: confiar e avaliar de novo tira a etiqueta de suspeito na execução seguinte", async () => {
    add("q", {
      from: "RH <rh@acme.example>",
      subject: "Vaga",
      html: "<p>Pague a taxa via PIX</p>",
    });
    await sync();
    const suspect = () => state.labels.find((l) => l.name === MAIL_SUSPECT_LABEL)?.id as string;
    expect(state.messages.find((m) => m.id === "q")?.labelIds).toContain(suspect());
    // a pessoa confia no remetente e o e-mail volta a ser avaliado; com o texto sem o golpe, sai da quarentena
    const msg = repos.mail.byGmailId("q");
    repos.mail.reset(msg?.id as string, new Date().toISOString());
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(dataDir, msg?.rawPath as string),
      rawMail({ from: "RH <rh@acme.example>", subject: "Vaga" }),
    );
    await sync();
    expect(repos.mail.byGmailId("q")).toMatchObject({ status: "pending", suspectLabel: false });
    expect(state.messages.find((m) => m.id === "q")?.labelIds).not.toContain(suspect());
  });

  it("revisão #6: notificação fora do assunto com termo suspeito fica intocada (sem etiqueta)", async () => {
    add("post", {
      from: "LinkedIn <notifications-noreply@linkedin.com>",
      subject: "Ana comentou",
      html: "<p>renda extra já!</p>",
    });
    await sync();
    expect(repos.mail.byGmailId("post")).toMatchObject({ status: "ignored", suspectLabel: false });
    expect(state.messages.find((m) => m.id === "post")?.labelIds).toEqual(["INBOX", "UNREAD"]);
  });
});
