import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTO_STAGE_MIN_DECISIONS,
  applyMailApplications,
  applyMailUpdates,
  approveStageSuggestion,
  createRepos,
  interviewInstant,
  matchStage,
  migrate,
  openDatabase,
  type Repos,
  setCurrentStage,
  stageLearning,
  undoMail,
} from "../../src";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F14/M6 · atualizações, convites e desfazer: nota sempre; etapa sugerida (ou movida sozinha quando o aprendizado
 * permite); convite `.ics` oficial, remarcação, cancelamento, etapa provisória substituída; desfazer por e-mail.
 */
const out = (o: Partial<MailClassifyOutput>): MailClassifyOutput => ({
  class: "update",
  confidence: 95,
  company: "Acme",
  title: "Backend Sr",
  postingUrl: null,
  jobs: [],
  stageHint: null,
  actions: [],
  process: null,
  interview: null,
  summary: "Resumo.",
  ...o,
});
const ctx = { log: () => {}, item: () => {}, count: () => {}, publish: async () => {} };

const ics = (o: { uid: string; start: string; end: string; method?: string; status?: string }) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `METHOD:${o.method ?? "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${o.uid}`,
    `DTSTART;TZID=America/Sao_Paulo:${o.start}`,
    `DTEND;TZID=America/Sao_Paulo:${o.end}`,
    `STATUS:${o.status ?? "CONFIRMED"}`,
    "SUMMARY:Entrevista técnica",
    "DESCRIPTION:Google Meet: https://meet.google.com/abc-defg-hij",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const eml = (calendar: string | null) =>
  [
    "From: RH Acme <rh@acme.example>",
    "To: eu@example.com",
    "Subject: Convite",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Convite para a entrevista técnica.",
    ...(calendar
      ? [
          "--b1",
          'Content-Type: text/calendar; charset=utf-8; method=REQUEST; name="invite.ics"',
          'Content-Disposition: attachment; filename="invite.ics"',
          "",
          calendar,
        ]
      : []),
    "--b1--",
    "",
  ].join("\r\n");

describe("F14/M6 · atualizações, convites e desfazer", () => {
  let repos: Repos;
  let dataDir: string;
  let n = 0;
  beforeEach(() => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-mail-upd-"));
    seedFixture(repos, "engineer");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const mail = (
    cls: MailClassifyOutput,
    receivedAt: string,
    o: { risk?: "trusted" | "neutral"; thread?: string; calendar?: string } = {},
  ) => {
    const gmailId = `u${++n}`;
    writeFileSync(join(dataDir, `${gmailId}.eml`), eml(o.calendar ?? null));
    const { record } = repos.mail.insert(
      {
        gmailId,
        threadId: o.thread ?? null,
        fromAddr: "rh@acme.example",
        fromName: "RH Acme",
        replyTo: null,
        subject: "Assunto",
        receivedAt,
        size: 1,
        labels: [],
        rawPath: `${gmailId}.eml`,
      },
      receivedAt,
    );
    repos.mail.setAssessment(
      record.id,
      { status: "pending", class: "candidate", riskLevel: o.risk ?? "trusted", riskReasons: [] },
      receivedAt,
    );
    repos.mail.setResult(
      record.id,
      { status: "pending", class: cls.class, confidence: cls.confidence, result: cls as never },
      receivedAt,
    );
    return record.id;
  };
  const run = async () => {
    await applyMailApplications({ repos, dataDir, ctx });
    return applyMailUpdates({ repos, dataDir, ctx });
  };
  /** Candidatura criada pela confirmação, na conversa `t1`. */
  const applied = async () => {
    mail(out({ class: "application_received" }), "2026-11-01T10:00:00.000Z", { thread: "t1" });
    await run();
    return repos.jobApplications.list()[0] as NonNullable<
      ReturnType<typeof repos.jobApplications.get>
    >;
  };

  it("atualização: nota sempre; etapa sugerida (sem histórico de acerto) e notificação; aprovar à mão aprende", async () => {
    const app = await applied();
    mail(out({ stageHint: "Entrevista técnica" }), "2026-11-03T10:00:00.000Z", { thread: "t1" });
    expect(await run()).toMatchObject({ noted: 1, suggested: 1, moved: 0 });
    const notes = repos.jobApplicationEntries.list(app.id);
    expect(notes.some((e) => e.body?.includes("Atualização da candidatura"))).toBe(true);
    const [s] = repos.stageSuggestions.open(app.id);
    expect(s).toMatchObject({ toStageName: "Entrevista técnica", mode: "suggested" });
    expect(repos.notifications.list().some((x) => x.kind === "mail.stage_suggestion")).toBe(true);
    // a pessoa move para a etapa sugerida: conta como aprovada
    setCurrentStage(repos, app.id, s?.toStageId as string);
    expect(repos.stageSuggestions.get(s?.id as string)?.decision).toBe("approved");
    expect(repos.jobApplications.stageChanges(app.id).at(-1)).toMatchObject({ source: "manual" });
  });

  it("automático: liga com 20 decisões e 95% de acerto; move com o instante do e-mail; desfazer volta e esfria", async () => {
    const app = await applied();
    for (let i = 0; i < AUTO_STAGE_MIN_DECISIONS; i++) {
      const s = repos.stageSuggestions.create(
        {
          mailMessageId: repos.mail.listByStatus(["done"], 1)[0]?.id as string,
          applicationId: app.id,
          fromStageId: null,
          toStageId: null,
          toStageName: "x",
          hint: "x",
          company: null,
          platform: null,
          confidence: 95,
          mode: "suggested",
        },
        "2026-10-01T00:00:00.000Z",
      );
      repos.stageSuggestions.decide(s.id, "approved", "2026-10-01T00:00:00.000Z");
    }
    expect(stageLearning(repos)).toMatchObject({ active: true, decisions: 20 });
    const id = mail(
      out({ stageHint: "entrevista tecnica", confidence: 95 }),
      "2026-11-03T10:00:00.000Z",
      {
        thread: "t1",
      },
    );
    expect(await run()).toMatchObject({ moved: 1, suggested: 0 });
    const tech = app.stages.find((s) => s.name === "Entrevista técnica");
    expect(repos.jobApplications.get(app.id)?.currentStageId).toBe(tech?.id);
    expect(repos.jobApplications.stageChanges(app.id).at(-1)).toMatchObject({
      source: "email",
      at: "2026-11-03T10:00:00.000Z",
    });
    undoMail(repos, dataDir, id);
    expect(repos.jobApplications.get(app.id)?.currentStageId).toBe(app.currentStageId);
    expect(repos.mail.get(id)).toMatchObject({ status: "ignored" });
    // desfeito = erro (acerto cai) e o automático esfria
    expect(stageLearning(repos)).toMatchObject({ active: false });
    expect(stageLearning(repos).lastUndoAt).not.toBeNull();
  });

  it("remetente sem confiança nunca move sozinho; etapa para trás não é sugerida", async () => {
    const app = await applied();
    const tech = app.stages.find((s) => s.name === "Entrevista técnica")?.id as string;
    setCurrentStage(repos, app.id, tech);
    mail(out({ stageHint: "Bate-papo com Talent" }), "2026-11-03T10:00:00.000Z", { thread: "t1" });
    expect(await run()).toMatchObject({ noted: 1, suggested: 0 });
    mail(out({ stageHint: "Oferta" }), "2026-11-04T10:00:00.000Z", {
      thread: "t1",
      risk: "neutral",
    });
    expect(await run()).toMatchObject({ suggested: 1, moved: 0 });
  });

  it("dica sem etapa: a etapa escolhida na aprovação vira o vocabulário daquela empresa", async () => {
    const app = await applied();
    mail(out({ stageHint: "Painel com o time" }), "2026-11-03T10:00:00.000Z", { thread: "t1" });
    await run();
    const [s] = repos.stageSuggestions.open(app.id);
    expect(s?.toStageId).toBeNull();
    const lead = app.stages.find((x) => x.name === "Entrevista com liderança")?.id as string;
    approveStageSuggestion(repos, s?.id as string, lead);
    expect(repos.stageSuggestions.get(s?.id as string)).toMatchObject({
      decision: "approved",
      correctedStageName: "Entrevista com liderança",
      appliedStageId: lead,
    });
    expect(
      matchStage(repos, repos.jobApplications.get(app.id) as never, "Painel com o time", {
        company: "Acme",
        platform: null,
      }),
    ).toMatchObject({ via: "aprendido", stage: { name: "Entrevista com liderança" } });
  });

  it("revisão #1/#2/#7: avançar depois não é correção; voltar é; aprovar com outra etapa é", async () => {
    const app = await applied();
    const st = (n: string) => app.stages.find((x) => x.name === n)?.id as string;
    mail(out({ stageHint: "Bate-papo com Talent" }), "2026-11-02T10:00:00.000Z", { thread: "t1" });
    await run();
    const [a] = repos.stageSuggestions.open(app.id);
    approveStageSuggestion(repos, a?.id as string, undefined, new Date("2026-11-02T12:00:00Z"));
    // dois dias depois a pessoa avança: o e-mail acertou
    setCurrentStage(repos, app.id, st("Entrevista técnica"), new Date("2026-11-04T12:00:00Z"));
    expect(repos.stageSuggestions.get(a?.id as string)?.decision).toBe("approved");
    // sugestão errada aprovada com outra etapa: correção
    mail(out({ stageHint: "Oferta" }), "2026-11-05T10:00:00.000Z", { thread: "t1" });
    await run();
    const [b] = repos.stageSuggestions.open(app.id);
    approveStageSuggestion(repos, b?.id as string, st("Contratação"));
    expect(repos.stageSuggestions.get(b?.id as string)?.decision).toBe("corrected");
    // voltar para antes da etapa aplicada também é
    mail(out({ stageHint: "Contratação" }), "2026-11-06T10:00:00.000Z", { thread: "t1" });
    await run();
    expect(repos.stageSuggestions.open(app.id)).toHaveLength(0); // já está lá: nada a sugerir
  });

  it("revisão #8: troca manual fecha sugestões que ficaram para trás; aprovar etapa anterior dá stale", async () => {
    const app = await applied();
    const st = (n: string) => app.stages.find((x) => x.name === n)?.id as string;
    mail(out({ stageHint: "Bate-papo com Talent" }), "2026-11-02T10:00:00.000Z", { thread: "t1" });
    mail(out({ stageHint: "Oferta" }), "2026-11-03T10:00:00.000Z", { thread: "t1" });
    await run();
    expect(repos.stageSuggestions.open(app.id)).toHaveLength(2);
    setCurrentStage(repos, app.id, st("Entrevista técnica"));
    const open = repos.stageSuggestions.open(app.id);
    expect(open.map((x) => x.toStageName)).toEqual(["Oferta"]);
    setCurrentStage(repos, app.id, st("Contratação"));
    mail(out({ stageHint: "Oferta" }), "2026-11-04T10:00:00.000Z", { thread: "t1" });
    await run();
    const s = repos.stageSuggestions.create(
      {
        mailMessageId: repos.mail.listByStatus(["done"], 1)[0]?.id as string,
        applicationId: app.id,
        fromStageId: null,
        toStageId: st("Oferta"),
        toStageName: "Oferta",
        hint: "Oferta",
        company: null,
        platform: null,
        confidence: 90,
        mode: "suggested",
      },
      new Date().toISOString(),
    );
    expect(() => approveStageSuggestion(repos, s.id, undefined)).toThrow(/já passou/);
  });

  it("convite .ics: evento oficial; remarcação atualiza; cancelamento marca; desfazer devolve", async () => {
    const app = await applied();
    mail(
      out({ class: "interview_invite", stageHint: "Entrevista técnica" }),
      "2026-11-03T10:00:00.000Z",
      {
        thread: "t1",
        calendar: ics({ uid: "e1@acme", start: "20261112T140000", end: "20261112T150000" }),
      },
    );
    expect(await run()).toMatchObject({ events: 1 });
    const [ev] = repos.jobApplicationEvents.list(app.id);
    expect(ev).toMatchObject({
      icsUid: "e1@acme",
      provisional: false,
      startsAt: "2026-11-12T17:00:00.000Z",
      durationMin: 60,
      link: "https://meet.google.com/abc-defg-hij",
    });
    const re = mail(out({ class: "interview_invite" }), "2026-11-04T10:00:00.000Z", {
      thread: "t1",
      calendar: ics({ uid: "e1@acme", start: "20261113T100000", end: "20261113T110000" }),
    });
    await run();
    expect(repos.jobApplicationEvents.list(app.id)).toHaveLength(1);
    expect(repos.jobApplicationEvents.get(ev?.id as string)?.startsAt).toBe(
      "2026-11-13T13:00:00.000Z",
    );
    mail(out({ class: "update" }), "2026-11-05T10:00:00.000Z", {
      thread: "t1",
      calendar: ics({
        uid: "e1@acme",
        start: "20261113T100000",
        end: "20261113T110000",
        method: "CANCEL",
        status: "CANCELLED",
      }),
    });
    await run();
    expect(repos.jobApplicationEvents.get(ev?.id as string)?.cancelledAt).not.toBeNull();
    // desfazer a remarcação devolve o horário anterior
    const cancel = repos.mail
      .listByStatus(["done"], 10)
      .find((m) => m.receivedAt.startsWith("2026-11-05"));
    undoMail(repos, dataDir, cancel?.id as string);
    undoMail(repos, dataDir, re);
    expect(repos.jobApplicationEvents.get(ev?.id as string)).toMatchObject({
      startsAt: "2026-11-12T17:00:00.000Z",
      cancelledAt: null,
    });
  });

  it("sem .ics: etapa provisória com o horário escrito; o oficial a substitui e avisa do bloqueio", async () => {
    const app = await applied();
    mail(
      out({
        class: "interview_invite",
        stageHint: "Entrevista técnica",
        interview: {
          startsAt: "2026-11-12T14:00",
          timeZone: "America/Sao_Paulo",
          durationMin: 45,
          link: null,
          location: null,
        },
      }),
      "2026-11-03T10:00:00.000Z",
      { thread: "t1" },
    );
    await run();
    const [prov] = repos.jobApplicationEvents.list(app.id);
    expect(prov).toMatchObject({
      provisional: true,
      startsAt: "2026-11-12T17:00:00.000Z",
      durationMin: 45,
    });
    repos.jobApplicationEvents.setBlocked(prov?.id as string, "2026-11-03T11:00:00.000Z");
    mail(out({ class: "interview_invite" }), "2026-11-04T10:00:00.000Z", {
      thread: "t1",
      calendar: ics({ uid: "e2@acme", start: "20261112T140000", end: "20261112T150000" }),
    });
    await run();
    const all = repos.jobApplicationEvents.list(app.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: prov?.id, provisional: false, icsUid: "e2@acme" });
    const n = repos.notifications.list({ status: "all" }).find((x) => x.kind === "mail.interview");
    expect(n?.body).toMatch(/bloqueio/);
  });

  it("sem candidatura: revisão; contato de recrutador sem candidatura só fica registrado", async () => {
    const a = mail(
      out({ company: "Globex", title: "Dados", stageHint: "Teste" }),
      "2026-11-03T10:00:00.000Z",
    );
    const b = mail(
      out({ class: "recruiter_contact", company: "Globex", title: "Dados" }),
      "2026-11-03T11:00:00.000Z",
    );
    expect(await run()).toMatchObject({ review: 1 });
    expect(repos.mail.get(a)?.status).toBe("review");
    expect(repos.mail.get(b)?.status).toBe("done");
  });

  it("desfazer a confirmação apaga a candidatura e a vaga criada; desfazer a negativa reabre", async () => {
    const conf = mail(
      out({ class: "application_received", company: "Initech", title: "SRE" }),
      "2026-11-01T10:00:00.000Z",
    );
    await run();
    const app = repos.jobApplications.list()[0];
    const neg = mail(
      out({ class: "rejection", company: "Initech", title: "SRE" }),
      "2026-11-02T10:00:00.000Z",
    );
    await run();
    expect(repos.jobApplications.get(app?.id as string)?.column).toBe("closed");
    undoMail(repos, dataDir, neg);
    expect(repos.jobApplications.get(app?.id as string)).toMatchObject({
      column: "applied",
      closedReason: null,
    });
    expect(() => undoMail(repos, dataDir, neg)).toThrow(/já foi desfeito/);
    undoMail(repos, dataDir, conf);
    expect(repos.jobApplications.get(app?.id as string)).toBeNull();
    expect(repos.postings.get(app?.postingId as string)).toBeNull();
  });

  it("horário do convite: com deslocamento, local no fuso dito, inválido", () => {
    const i = { timeZone: null, durationMin: null, link: null, location: null };
    expect(interviewInstant({ ...i, startsAt: "2026-11-12T14:00:00-03:00" }, "UTC")).toBe(
      "2026-11-12T17:00:00.000Z",
    );
    expect(
      interviewInstant(
        { ...i, startsAt: "2026-11-12 14:00", timeZone: "America/Sao_Paulo" },
        "UTC",
      ),
    ).toBe("2026-11-12T17:00:00.000Z");
    expect(interviewInstant({ ...i, startsAt: "amanhã às 14h" }, "UTC")).toBeNull();
  });

  it("revisão #4: remetente sem confiança não remarca nem cancela; vai para a revisão pedindo confirmação", async () => {
    const app = await applied();
    mail(out({ class: "interview_invite" }), "2026-11-03T10:00:00.000Z", {
      thread: "t1",
      calendar: ics({ uid: "e1@acme", start: "20261112T140000", end: "20261112T150000" }),
    });
    await run();
    const r = mail(out({ class: "interview_invite" }), "2026-11-04T10:00:00.000Z", {
      thread: "t1",
      risk: "neutral",
      calendar: ics({ uid: "e1@acme", start: "20261113T100000", end: "20261113T110000" }),
    });
    expect(await run()).toMatchObject({ review: 1 });
    expect(repos.mail.get(r)).toMatchObject({ status: "review" });
    expect(repos.mail.get(r)?.result).toMatchObject({ needsConfirm: true });
    expect(repos.jobApplicationEvents.list(app.id)[0]?.startsAt).toBe("2026-11-12T17:00:00.000Z");
    // nem a nota ficou (a transação voltou)
    expect(
      repos.jobApplicationEntries.list(app.id).filter((e) => e.body?.includes("Convite")),
    ).toHaveLength(1);
  });

  it("revisão #12: convite com SEQUENCE menor que o já recebido é ignorado", async () => {
    const app = await applied();
    const seq = (n: number, start: string) =>
      ics({
        uid: "e9@acme",
        start,
        end: start.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 1).padStart(2, "0")}`),
      }).replace("STATUS:", `SEQUENCE:${n}\r\nSTATUS:`);
    mail(out({ class: "interview_invite" }), "2026-11-03T10:00:00.000Z", {
      thread: "t1",
      calendar: seq(2, "20261112T140000"),
    });
    mail(out({ class: "interview_invite" }), "2026-11-04T10:00:00.000Z", {
      thread: "t1",
      calendar: seq(1, "20261110T090000"),
    });
    await run();
    expect(repos.jobApplicationEvents.list(app.id)[0]?.startsAt).toBe("2026-11-12T17:00:00.000Z");
  });

  it("revisão #3/#5: desfazer não apaga o que veio depois e não apaga candidatura com mais coisas", async () => {
    const app = await applied();
    const conf = repos.mail.listByStatus(["done"], 5)[0]?.id as string;
    mail(out({ stageHint: "Entrevista técnica" }), "2026-11-03T10:00:00.000Z", { thread: "t1" });
    await run();
    const [s] = repos.stageSuggestions.open(app.id);
    approveStageSuggestion(repos, s?.id as string, undefined);
    // a pessoa avança depois; desfazer o e-mail não volta a etapa
    const lead = app.stages.find((x) => x.name === "Oferta")?.id as string;
    setCurrentStage(repos, app.id, lead);
    const r = undoMail(repos, dataDir, s?.mailMessageId as string);
    expect(r.skipped).toEqual(["etapa (mudou depois)"]);
    expect(repos.jobApplications.get(app.id)?.currentStageId).toBe(lead);
    // a candidatura tem outra nota (da pessoa): desfazer a confirmação recusa
    repos.jobApplicationEntries.create({
      applicationId: app.id,
      occurredOn: "2026-11-05",
      body: "minha nota",
      attachments: [],
    });
    expect(() => undoMail(repos, dataDir, conf)).toThrow(/já tem/);
  });

  it("revisão #13: negativa mais nova espera o convite mais antigo (ordem entre M5 e M6)", async () => {
    const app = await applied();
    const neg = mail(out({ class: "rejection" }), "2026-11-09T10:00:00.000Z", { thread: "t1" });
    mail(out({ class: "interview_invite" }), "2026-11-05T10:00:00.000Z", {
      thread: "t1",
      calendar: ics({ uid: "e5@acme", start: "20261108T140000", end: "20261108T150000" }),
    });
    // a ordem do agendador: M5 primeiro segura a negativa; o M6 aplica o convite; o M5 encerra na passada seguinte
    expect(await applyMailApplications({ repos, dataDir, ctx })).toMatchObject({ closed: 0 });
    expect(await applyMailUpdates({ repos, dataDir, ctx })).toMatchObject({ events: 1 });
    expect(await applyMailApplications({ repos, dataDir, ctx })).toMatchObject({ closed: 1 });
    expect(repos.mail.get(neg)?.status).toBe("done");
    expect(repos.jobApplicationEvents.list(app.id)).toHaveLength(1);
  });
});
