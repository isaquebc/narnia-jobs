import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addJobApplicationEntry,
  createRepos,
  fakeGmailAdd,
  fakeGmailFetch,
  fakeGmailState,
  finishGmailConnect,
  type GoogleClient,
  gmailSource,
  MAIL_REDO_LOCK_KEY,
  MAIL_SINCE_KEY,
  type MailClassifier,
  MailRedoError,
  migrate,
  openDatabase,
  type Repos,
  redoMailRuns,
  runScheduledTask,
  startGmailConnect,
  undoMail,
} from "../../src";
import { seedFixture } from "../../src/testing/profile-fixtures";
import { rawMail } from "./fixtures";

/**
 * Pedido do dono 2026-11-11 e 2026-11-12 · desfazer as leituras de e-mails para testar o mecanismo novo: tudo que as
 * leituras escolhidas criaram sai (mesmo o que a pessoa usou), menos as vagas que já existiam antes; os e-mails voltam
 * para a fila e a leitura agendada fica pausada até a pessoa clicar em "Rodar agora".
 */
const client: GoogleClient = { clientId: "id-123456789", clientSecret: "s", source: "env" };
const T = Date.parse("2026-11-11T12:00:00Z");
const DAY = 86_400_000;

const out = (o: Partial<MailClassifyOutput>): MailClassifyOutput => ({
  class: "not_job",
  confidence: 95,
  company: null,
  title: null,
  postingUrl: null,
  jobs: [],
  stageHint: null,
  interview: null,
  summary: "x",
  ...o,
});

describe("desfazer e refazer a leitura dos e-mails", () => {
  let repos: Repos;
  let dataDir: string;
  let state: ReturnType<typeof fakeGmailState>;
  beforeEach(async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    seedFixture(repos, "engineer");
    dataDir = mkdtempSync(join(tmpdir(), "narnia-mail-redo-"));
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
    repos.mailSenders.setOverride(
      "rh@acme.example",
      "trusted",
      "manual",
      new Date(T).toISOString(),
    );
    fakeGmailAdd(state, {
      id: "alerta",
      internalDate: T - 3 * DAY,
      raw: rawMail({
        from: "LinkedIn <jobalerts-noreply@linkedin.com>",
        subject: "Vagas para você",
        html: `<a href="https://www.linkedin.com/comm/jobs/view/4012345678/">Desenvolvedor Backend Sênior</a><p>Globex · Remoto</p>
               <a href="https://www.linkedin.com/comm/jobs/view/4099999999/">Engenheira de Dados</a><p>Initech · Remoto</p>`,
      }).toString(),
    });
    fakeGmailAdd(state, {
      id: "confirma",
      internalDate: T - 2 * DAY,
      raw: rawMail({
        from: "RH Acme <rh@acme.example>",
        subject: "Recebemos sua candidatura",
      }).toString(),
    });
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const classify: MailClassifier = async (i) =>
    /candidatura/i.test(i.subject)
      ? out({ class: "application_received", company: "Acme", title: "Dev Backend" })
      : out({});
  const sync = () =>
    runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "manual",
      now: new Date(T),
      publish: async () => {},
      mailSource: () =>
        gmailSource({
          fetch: fakeGmailFetch(state, { now: () => T }),
          dataDir,
          client: () => client,
        }),
      services: { classifyMail: classify },
    });

  it("apaga tudo o que a leitura criou, mesmo o que a pessoa usou; e-mails voltam à fila e a leitura fica pausada", async () => {
    const run = await sync();
    expect(repos.jobApplications.list()).toHaveLength(1);
    const alertFeed = () =>
      repos.postings.feed().filter((p) => p.sourceRef?.platform === "linkedin");
    expect(alertFeed()).toHaveLength(2);
    // a pessoa abriu uma vaga e anotou na candidatura: sai também (pedido do dono 2026-11-12, "tudo deve ser limpo")
    repos.postings.touchInteraction(alertFeed()[0]?.id as string);
    const app = repos.jobApplications.list()[0] as { id: string };
    addJobApplicationEntry(repos, dataDir, app.id, {
      occurredOn: "2026-11-10",
      body: "liguei para o RH",
      files: [],
    });

    const r = redoMailRuns(repos, dataDir, run.id, new Date(T));
    expect(r).toMatchObject({ mails: 2, applicationsRemoved: 1, kept: [] });
    expect(r.postingsRemoved).toBe(3);
    expect(repos.jobApplications.list()).toHaveLength(0);
    expect(repos.postings.list().filter((p) => p.source === "email")).toHaveLength(0);
    for (const id of ["alerta", "confirma"])
      expect(repos.mail.byGmailId(id)).toMatchObject({
        status: "pending",
        class: null,
        result: null,
        undo: null,
        undoneAt: null,
      });
    // nada lê de novo sozinho: a leitura agendada fica pausada e "Rodar agora" lê
    expect(repos.scheduled.task("mail.sync").paused).toBe(true);

    await sync();
    expect(repos.jobApplications.list()).toHaveLength(1);
    expect(alertFeed()).toHaveLength(2);
    expect(repos.mail.byGmailId("confirma")?.status).toBe("done");
  });

  it("vaga que já existia antes da leitura fica; sai só a candidatura que o e-mail criou nela", async () => {
    const before = repos.postings.create({ company: "Acme", title: "Dev Backend" } as never, {
      source: "user",
    });
    repos.postings.setOrigin(before.id, { source: "extension" });
    const run = await sync();
    const app = repos.jobApplications.list()[0];
    expect(app?.postingId).toBe(before.id);

    const r = redoMailRuns(repos, dataDir, run.id, new Date(T));
    expect(r.applicationsRemoved).toBe(1);
    expect(repos.jobApplications.list()).toHaveLength(0);
    expect(repos.postings.get(before.id)).not.toBeNull();
  });

  it("desde uma leitura antiga: pega as seguintes também; sem leitura, todas; outra tarefa ou inexistente: erro", async () => {
    const first = await sync();
    fakeGmailAdd(state, {
      id: "novo",
      internalDate: T - 3_600_000,
      raw: rawMail({ from: "RH Acme <rh@acme.example>", subject: "Novidades" }).toString(),
    });
    const second = await runScheduledTask({
      repos,
      dataDir,
      taskId: "mail.sync",
      trigger: "manual",
      now: new Date(T + 60_000),
      publish: async () => {},
      mailSource: () =>
        gmailSource({
          fetch: fakeGmailFetch(state, { now: () => T }),
          dataDir,
          client: () => client,
        }),
      services: { classifyMail: classify },
    });
    expect(redoMailRuns(repos, dataDir, second.id, new Date(T)).mails).toBe(1);
    expect(redoMailRuns(repos, dataDir, first.id, new Date(T)).mails).toBe(3);
    expect(redoMailRuns(repos, dataDir, null, new Date(T)).mails).toBe(3);
    expect(() => redoMailRuns(repos, dataDir, "nao-existe")).toThrow(MailRedoError);
    const other = await runScheduledTask({
      repos,
      dataDir,
      taskId: "postings.feed_archive",
      trigger: "manual",
      publish: async () => {},
    });
    expect(() => redoMailRuns(repos, dataDir, other.id)).toThrow(/leitura de e-mails/);
  });

  it("e-mail que a pessoa já desfez também volta à fila; com a trava, a leitura espera", async () => {
    const run = await sync();
    const conf = repos.mail.byGmailId("confirma");
    undoMail(repos, dataDir, conf?.id as string, new Date(T));
    const r = redoMailRuns(repos, dataDir, run.id, new Date(T));
    expect(r).toMatchObject({ mails: 2, kept: [] });
    expect(repos.mail.byGmailId("confirma")).toMatchObject({ status: "pending", undoneAt: null });
    expect(repos.jobApplications.list()).toHaveLength(0);

    repos.settings.set(MAIL_REDO_LOCK_KEY, new Date().toISOString());
    const blocked = await sync();
    expect(repos.scheduled.run(blocked.id)?.log.some((l) => /Desfazendo/.test(l.message))).toBe(
      true,
    );
    expect(() => redoMailRuns(repos, dataDir, run.id)).toThrow(/rodando/);
  });
});
