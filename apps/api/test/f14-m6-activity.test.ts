import {
  AUTO_STAGE_MIN_DECISIONS,
  applyMailApplications,
  applyMailUpdates,
  seedFixture,
} from "@narnia-jobs/core";
import type { MailClassifyOutput } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14/M6 na API: atividade de e-mail da candidatura (e-mails com desfazer, sugestões abertas, histórico de etapas),
 * aprovar e recusar a sugestão, desfazer um e-mail, bloquear a agenda e a chave do automático.
 */
const req = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
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
  summary: "Resumo do e-mail.",
  ...o,
});
const ctx = { log: () => {}, item: () => {}, count: () => {}, publish: async () => {} };

describe("F14/M6 · atividade de e-mail, sugestões e desfazer", () => {
  let t: TestApp;
  let n = 0;
  afterEach(() => t?.cleanup());

  const mail = (cls: MailClassifyOutput, receivedAt: string) => {
    const gmailId = `m${++n}`;
    const { record } = t.repos.mail.insert(
      {
        gmailId,
        threadId: "t1",
        fromAddr: "rh@acme.example",
        fromName: "RH Acme",
        replyTo: null,
        subject: `Assunto ${gmailId}`,
        receivedAt,
        size: 1,
        labels: [],
        rawPath: `mail/${gmailId}.eml`,
      },
      receivedAt,
    );
    t.repos.mail.setAssessment(
      record.id,
      { status: "pending", class: "candidate", riskLevel: "trusted", riskReasons: [] },
      receivedAt,
    );
    t.repos.mail.setResult(
      record.id,
      { status: "pending", class: cls.class, confidence: cls.confidence, result: cls as never },
      receivedAt,
    );
    return record.id;
  };
  const run = async () => {
    await applyMailApplications({ repos: t.repos, dataDir: t.dataDir, ctx });
    await applyMailUpdates({ repos: t.repos, dataDir: t.dataDir, ctx });
  };

  it("atividade lista os e-mails e a sugestão; aprovar move e resolve a notificação; desfazer o e-mail", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const conf = mail(out({ class: "application_received" }), "2026-11-01T10:00:00.000Z");
    await run();
    const app = t.repos.jobApplications.list()[0] as { id: string };
    const upd = mail(out({ stageHint: "Entrevista técnica" }), "2026-11-03T10:00:00.000Z");
    await run();
    const a = (await (await t.api(`/api/job-applications/${app.id}/mail-activity`)).json()) as {
      mails: Array<{ id: string; canUndo: boolean; summary: string }>;
      suggestions: Array<{ id: string; toStageName: string; toStageId: string }>;
    };
    expect(a.mails).toHaveLength(2);
    expect(a.mails.every((m) => m.canUndo)).toBe(true);
    expect(a.suggestions[0]?.toStageName).toBe("Entrevista técnica");
    const ok = await t.api(
      `/api/stage-suggestions/${a.suggestions[0]?.id}/approve`,
      req("POST", {}),
    );
    expect(ok.status).toBe(200);
    expect(t.repos.jobApplications.get(app.id)?.currentStageId).toBe(a.suggestions[0]?.toStageId);
    expect(
      t.repos.notifications.list().filter((x) => x.kind === "mail.stage_suggestion"),
    ).toHaveLength(0);
    // decidida não decide de novo
    expect(
      (await t.api(`/api/stage-suggestions/${a.suggestions[0]?.id}/reject`, req("POST"))).status,
    ).toBe(409);
    const h = (await (await t.api(`/api/job-applications/${app.id}/mail-activity`)).json()) as {
      stageChanges: Array<{ source: string; toStageName: string }>;
    };
    expect(h.stageChanges.at(-1)).toMatchObject({
      source: "suggestion",
      toStageName: "Entrevista técnica",
    });
    // com a atualização ainda aplicada, desfazer a confirmação recusa (a candidatura tem mais que o e-mail criou)
    const busy = await t.api(`/api/mail/${conf}/undo`, req("POST"));
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: { details: string[] } }).error.details).toContain(
      "1 outro(s) e-mail(s)",
    );
    // desfazer a atualização volta a etapa aprovada; depois a confirmação apaga a candidatura
    expect((await t.api(`/api/mail/${upd}/undo`, req("POST"))).status).toBe(200);
    const u = await t.api(`/api/mail/${conf}/undo`, req("POST"));
    expect(u.status).toBe(200);
    expect(t.repos.jobApplications.get(app.id)).toBeNull();
    expect((await t.api(`/api/mail/${conf}/undo`, req("POST"))).status).toBe(409);
  });

  it("sugestão sem etapa correspondente pede a etapa; recusar fecha", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    mail(out({ class: "application_received" }), "2026-11-01T10:00:00.000Z");
    await run();
    const app = t.repos.jobApplications.list()[0] as {
      id: string;
      stages: Array<{ id: string; name: string }>;
    };
    mail(out({ stageHint: "Painel com o time" }), "2026-11-03T10:00:00.000Z");
    mail(out({ stageHint: "Conversa com o CTO" }), "2026-11-04T10:00:00.000Z");
    await run();
    const [s2, s1] = t.repos.stageSuggestions.open(app.id);
    expect((await t.api(`/api/stage-suggestions/${s1?.id}/approve`, req("POST", {}))).status).toBe(
      400,
    );
    const lead = app.stages.find((s) => s.name === "Entrevista com liderança")?.id;
    expect(
      (await t.api(`/api/stage-suggestions/${s1?.id}/approve`, req("POST", { stageId: lead })))
        .status,
    ).toBe(200);
    // a etapa escolhida vira o vocabulário
    expect(t.repos.stageSuggestions.get(s1?.id as string)?.correctedStageName).toBe(
      "Entrevista com liderança",
    );
    expect((await t.api(`/api/stage-suggestions/${s2?.id}/reject`, req("POST"))).status).toBe(204);
    expect(t.repos.stageSuggestions.get(s2?.id as string)?.decision).toBe("rejected");
  });

  it("bloquear a agenda da etapa provisória; chave do automático", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    mail(out({ class: "application_received" }), "2026-11-01T10:00:00.000Z");
    mail(
      out({
        class: "interview_invite",
        interview: {
          startsAt: "2026-11-12T14:00:00-03:00",
          timeZone: null,
          durationMin: 60,
          link: null,
          location: null,
        },
      }),
      "2026-11-03T10:00:00.000Z",
    );
    await run();
    const app = t.repos.jobApplications.list()[0] as { id: string };
    const [ev] = t.repos.jobApplicationEvents.list(app.id);
    expect(ev?.provisional).toBe(true);
    const b = (await (
      await t.api(
        `/api/job-applications/${app.id}/events/${ev?.id}/block`,
        req("POST", { blocked: true }),
      )
    ).json()) as { event: { blockedAt: string | null } };
    expect(b.event.blockedAt).not.toBeNull();
    const l = (await (await t.api("/api/mail/stage-learning")).json()) as {
      allowed: boolean;
      active: boolean;
      reason: string;
    };
    expect(l).toMatchObject({ allowed: true, active: false });
    expect(l.reason).toBe("few_decisions");
    expect(l).toMatchObject({ minDecisions: AUTO_STAGE_MIN_DECISIONS });
    const off = (await (
      await t.api("/api/mail/stage-learning", req("PUT", { allowed: false }))
    ).json()) as { allowed: boolean };
    expect(off.allowed).toBe(false);
  });
});
