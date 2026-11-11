import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMailApplications,
  createRepos,
  migrate,
  openDatabase,
  type Repos,
  syncMailReviewNotification,
} from "../../src";
import { applyToPosting } from "../../src/job-applications";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F14/M5 · candidatura recebida e negativa vindas de e-mail: ligação à vaga (link, empresa e cargo, candidatura
 * ativa da empresa), candidatura criada com o instante do e-mail e sem CV (F14-15), perfil (F14-5), negativa que
 * encerra com a data e a hora do e-mail, ordem cronológica e caixa de revisão na dúvida.
 */
const out = (o: Partial<MailClassifyOutput>): MailClassifyOutput => ({
  class: "application_received",
  confidence: 95,
  company: null,
  title: null,
  postingUrl: null,
  jobs: [],
  stageHint: null,
  interview: null,
  summary: "Resumo.",
  ...o,
});
const ctx = { log: () => {}, item: () => {}, count: () => {}, publish: async () => {} };

describe("F14/M5 · candidaturas a partir de e-mail", () => {
  let repos: Repos;
  let dataDir: string;
  let n = 0;
  beforeEach(() => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-mail-app-"));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  /** E-mail já classificado (o M4 grava a classe e a saída do modelo). */
  const mail = (
    cls: MailClassifyOutput,
    receivedAt: string,
    risk: "trusted" | "neutral" = "trusted",
  ) => {
    const gmailId = `g${++n}`;
    const { record } = repos.mail.insert(
      {
        gmailId,
        threadId: null,
        fromAddr: "rh@acme.example",
        fromName: "RH Acme",
        replyTo: null,
        subject: "Assunto",
        receivedAt,
        size: 1,
        labels: [],
        rawPath: `mail/${gmailId}.eml`,
      },
      receivedAt,
    );
    repos.mail.setAssessment(
      record.id,
      { status: "pending", class: "candidate", riskLevel: risk, riskReasons: [] },
      receivedAt,
    );
    repos.mail.setResult(
      record.id,
      { status: "pending", class: cls.class, confidence: cls.confidence, result: cls as never },
      receivedAt,
    );
    return gmailId;
  };
  const run = () => applyMailApplications({ repos, dataDir, ctx });
  const moves = (appId: string) =>
    repos.db
      .prepare(
        "select to_column, at, source from job_application_move where job_application_id = ? order by at",
      )
      .all(appId);

  it("confirmação sem vaga salva: cria a vaga e a candidatura, com o instante do e-mail e sem CV; o e-mail vira nota", async () => {
    seedFixture(repos, "engineer");
    const g = mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-09T18:32:00.000Z");
    expect(await run()).toMatchObject({ created: 1 });
    const app = repos.jobApplications.list()[0];
    expect(app).toMatchObject({
      source: "email",
      cv: null,
      cvPresumed: false,
      appliedOn: "2026-11-09",
    });
    expect(moves(app?.id as string)).toEqual([
      { to_column: "applied", at: "2026-11-09T18:32:00.000Z", source: "email" },
    ]);
    expect(app?.lastActivityAt).not.toBe("2026-11-09T18:32:00.000Z");
    const notes = repos.jobApplicationEntries.list(app?.id as string);
    expect(notes[0]?.body).toContain(`#all/${g}`);
    expect(repos.mail.byGmailId(g)).toMatchObject({ status: "done" });
    expect(repos.postings.get(app?.postingId as string)).toMatchObject({
      source: "email",
      feedState: "seen",
    });
  });

  it("um perfil só: é o da candidatura; CV gerado para a vaga: o perfil dele, CV presumido", async () => {
    const { profileId } = seedFixture(repos, "engineer");
    const posting = repos.postings.create(
      { company: "Globex", title: "Dados" },
      { source: "user" },
    );
    const d = repos.documents.create({
      kind: "cv",
      profileId,
      postingId: posting.id,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    const v = repos.documents.addVersion(d.id, {
      source: "agent",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    repos.documents.updateVersion(v.id, { status: "ready" });
    mail(out({ company: "Globex", title: "Dados" }), "2026-11-09T10:00:00.000Z");
    await run();
    expect(repos.jobApplications.activeForPosting(posting.id)).toMatchObject({
      profileId,
      cvPresumed: true,
      cv: { versionId: v.id },
    });
  });

  it("confirmação e negativa do mesmo processo, na ordem do e-mail: cria e depois encerra com o instante da negativa", async () => {
    seedFixture(repos, "engineer");
    mail(
      out({ class: "rejection", company: "Acme", title: "Backend Sr" }),
      "2026-11-10T14:00:00.000Z",
    );
    mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-09T18:00:00.000Z");
    expect(await run()).toMatchObject({ created: 1, closed: 1 });
    const app = repos.jobApplications.list()[0];
    expect(app).toMatchObject({ column: "closed", closedReason: "rejected" });
    expect(moves(app?.id as string)).toEqual([
      { to_column: "applied", at: "2026-11-09T18:00:00.000Z", source: "email" },
      { to_column: "closed", at: "2026-11-10T14:00:00.000Z", source: "email" },
    ]);
    expect(repos.notifications.list().some((x) => x.kind === "mail.application_closed")).toBe(true);
  });

  it("negativa da candidatura feita pelo Aplicar: liga pela empresa e encerra; a candidatura não muda de origem", async () => {
    const { profileId } = seedFixture(repos, "engineer");
    const posting = repos.postings.create(
      { company: "Vitalis", title: "Analista de Dados" },
      { source: "user" },
    );
    const d = repos.documents.create({
      kind: "cv",
      profileId,
      postingId: null,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    const v = repos.documents.addVersion(d.id, {
      source: "agent",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    repos.documents.updateVersion(v.id, { status: "ready" });
    const app = applyToPosting(repos, {
      postingId: posting.id,
      cvVersionId: v.id,
      appliedOn: "2026-11-01",
    });
    mail(out({ class: "rejection", company: "Vitalis" }), "2026-11-08T14:00:00.000Z");
    await run();
    expect(repos.jobApplications.get(app.id)).toMatchObject({ column: "closed", source: "manual" });
  });

  it("na dúvida, revisão: duas vagas iguais sem candidatura, ou sem empresa e cargo", async () => {
    repos.postings.create({ company: "Acme", title: "Dev" }, { source: "user" });
    repos.postings.create({ company: "Acme", title: "Dev" }, { source: "user" });
    const a = mail(out({ company: "Acme", title: "Dev" }), "2026-11-09T10:00:00.000Z");
    const b = mail(out({ class: "rejection" }), "2026-11-09T11:00:00.000Z");
    expect(await run()).toMatchObject({ review: 2 });
    expect(repos.mail.byGmailId(a)?.status).toBe("review");
    expect((repos.mail.byGmailId(b)?.result as { review?: string } | undefined)?.review).toMatch(
      /empresa e o cargo/,
    );
    expect(repos.jobApplications.list()).toHaveLength(0);
  });

  it("notificação agrupada da revisão: conta revisão e quarentena; some quando a caixa esvazia", async () => {
    const published: string[] = [];
    const publish = async (e: { type: string }) => void published.push(e.type);
    const a = mail(out({}), "2026-11-09T10:00:00.000Z");
    await run();
    await syncMailReviewNotification(repos, publish as never);
    const open = repos.notifications.list().filter((x) => x.kind === "mail.review");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ actionUrl: "/emails", title: "1 e-mail(s) para revisar" });
    await syncMailReviewNotification(repos, publish as never);
    expect(repos.notifications.list().filter((x) => x.kind === "mail.review")).toHaveLength(1);
    repos.mail.setStatus(
      repos.mail.byGmailId(a)?.id as string,
      "ignored",
      "2026-11-09T12:00:00.000Z",
    );
    await syncMailReviewNotification(repos, publish as never);
    expect(repos.notifications.list().filter((x) => x.kind === "mail.review")).toHaveLength(0);
    expect(published).toEqual([
      "notification.created",
      "notification.updated",
      "notification.updated",
    ]);
  });

  it("vários perfis e nada que diga qual: perfil a escolher; remetente confiável pede a análise da vaga", async () => {
    seedFixture(repos, "engineer");
    seedFixture(repos, "leader");
    mail(out({ company: "Initech", title: "Tech Lead" }), "2026-11-09T10:00:00.000Z");
    await run();
    const app = repos.jobApplications.list()[0];
    expect(app).toMatchObject({ profilePending: true, profileId: null });
    expect(repos.postings.get(app?.postingId as string)?.autoAnalysisAt).not.toBeNull();
  });

  describe("revisão do M5", () => {
    it("#1 remetente sem confiança: não cria nem encerra sozinho; vai para a revisão pedindo confirmação", async () => {
      seedFixture(repos, "engineer");
      const posting = repos.postings.create(
        { company: "Acme", title: "Backend Sr" },
        { source: "user" },
      );
      const c = mail(
        out({ company: "Acme", title: "Backend Sr" }),
        "2026-11-09T10:00:00.000Z",
        "neutral",
      );
      expect(await run()).toMatchObject({ created: 0, review: 1 });
      expect(repos.mail.byGmailId(c)).toMatchObject({ status: "review" });
      expect(repos.mail.byGmailId(c)?.result).toMatchObject({
        needsConfirm: true,
        suggestedPostingId: posting.id,
      });
      // a pessoa confirma: agora cria
      const id = repos.mail.byGmailId(c)?.id as string;
      repos.mail.setPendingWith(
        id,
        { ...(repos.mail.get(id)?.result ?? {}), confirmed: true },
        "2026-11-09T11:00:00.000Z",
      );
      expect(await run()).toMatchObject({ created: 1 });
      const done = repos.mail.byGmailId(c)?.result as Record<string, unknown>;
      expect(done).not.toHaveProperty("review");
      expect(done).not.toHaveProperty("confirmed");
      expect(done).not.toHaveProperty("needsConfirm");
      // com candidatura já existente, o remetente sem confiança só grava a nota
      mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-09T12:00:00.000Z", "neutral");
      expect(await run()).toMatchObject({ noted: 1, review: 0 });
    });

    it("#3 negativa de candidatura arquivada encerra a mesma (sem duplicar); já encerrada só ganha a nota", async () => {
      seedFixture(repos, "engineer");
      mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-01T10:00:00.000Z");
      await run();
      const app = repos.jobApplications.list()[0] as { id: string };
      repos.jobApplications.update(app.id, { archived: true });
      mail(
        out({ class: "rejection", company: "Acme", title: "Backend Sr" }),
        "2026-11-09T10:00:00.000Z",
      );
      expect(await run()).toMatchObject({ closed: 1 });
      expect(
        repos.jobApplications.list({ archived: true }).length +
          repos.jobApplications.list({ archived: false }).length,
      ).toBe(1);
      expect(repos.jobApplications.get(app.id)).toMatchObject({
        column: "closed",
        archivedAt: null,
      });
      mail(
        out({ class: "rejection", company: "Acme", title: "Backend Sr" }),
        "2026-11-10T10:00:00.000Z",
      );
      expect(await run()).toMatchObject({ closed: 0, noted: 1, review: 0 });
    });

    it("#4 confirmação revisada depois da negativa (encerrada após o e-mail): só a nota, sem candidatura nova", async () => {
      seedFixture(repos, "engineer");
      mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-01T10:00:00.000Z");
      await run();
      mail(
        out({ class: "rejection", company: "Acme", title: "Backend Sr" }),
        "2026-11-09T10:00:00.000Z",
      );
      await run();
      // outra confirmação, anterior à negativa, que só agora foi lida
      mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-02T10:00:00.000Z");
      expect(await run()).toMatchObject({ created: 0, noted: 1 });
      expect(repos.jobApplications.list()).toHaveLength(1);
    });

    it("#4 ordem: e-mail mais antigo ainda sem classe segura os mais novos", async () => {
      seedFixture(repos, "engineer");
      const { record } = repos.mail.insert(
        {
          gmailId: "antigo",
          threadId: null,
          fromAddr: "rh@acme.example",
          fromName: null,
          replyTo: null,
          subject: "?",
          receivedAt: "2026-11-01T10:00:00.000Z",
          size: 1,
          labels: [],
          rawPath: "mail/antigo.eml",
        },
        "2026-11-01T10:00:00.000Z",
      );
      repos.mail.setAssessment(
        record.id,
        { status: "pending", class: "candidate", riskLevel: "trusted", riskReasons: [] },
        "2026-11-01T10:00:00.000Z",
      );
      const neg = mail(
        out({ class: "rejection", company: "Acme", title: "Backend Sr" }),
        "2026-11-09T10:00:00.000Z",
      );
      expect(await run()).toMatchObject({ closed: 0, review: 0 });
      expect(repos.mail.byGmailId(neg)?.status).toBe("pending");
    });

    it("#5 negativa sem vaga salva: revisão, sem criar vaga nem candidatura", async () => {
      seedFixture(repos, "engineer");
      mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-01T10:00:00.000Z");
      await run();
      const neg = mail(
        out({ class: "rejection", company: "Acme", title: "Desenvolvedor(a) Backend" }),
        "2026-11-09T10:00:00.000Z",
      );
      expect(await run()).toMatchObject({ closed: 0, review: 1 });
      expect(
        (repos.mail.byGmailId(neg)?.result as { review?: string } | undefined)?.review,
      ).toMatch(/nenhuma vaga salva/);
      expect(repos.postings.list()).toHaveLength(1);
      expect(repos.jobApplications.list()[0]).toMatchObject({ column: "applied" });
    });

    it("#2 erro no meio: nada do e-mail fica gravado e ele vai para a revisão", async () => {
      seedFixture(repos, "engineer");
      const posting = repos.postings.create(
        { company: "Acme", title: "Backend Sr" },
        { source: "user" },
      );
      mail(out({ company: "Acme", title: "Backend Sr" }), "2026-11-01T10:00:00.000Z");
      await run();
      const app = repos.jobApplications.activeForPosting(posting.id) as { id: string };
      // negativa com data no futuro: o encerramento falha depois de criar nada
      const neg = mail(
        out({ class: "rejection", company: "Acme", title: "Backend Sr" }),
        "2099-01-01T10:00:00.000Z",
      );
      const before = repos.jobApplicationEntries.list(app.id).length;
      expect(await run()).toMatchObject({ closed: 0, review: 1 });
      expect(repos.jobApplicationEntries.list(app.id)).toHaveLength(before);
      expect(repos.jobApplications.get(app.id)).toMatchObject({ column: "applied" });
      expect(repos.mail.byGmailId(neg)?.status).toBe("review");
    });
  });
});
