import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14/M5 · caixa de revisão (F14-11) e quarentena (F14-14) na API: listar com o motivo, ignorar (na quarentena o
 * remetente perde confiança), ligar a uma vaga escolhida (volta à fila com a vaga forçada e roda a leitura) e
 * processar a quarentena mesmo assim (sem nova avaliação de risco).
 */
const req = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const AT = "2026-11-11T12:00:00.000Z";

function mail(t: TestApp, gmailId: string, from = "rh@acme.example") {
  return t.repos.mail.insert(
    {
      gmailId,
      threadId: null,
      fromAddr: from,
      fromName: "RH Acme",
      replyTo: null,
      subject: `Assunto ${gmailId}`,
      receivedAt: AT,
      size: 1,
      labels: [],
      rawPath: `mail/${gmailId}.eml`,
    },
    AT,
  ).record;
}

function inReview(t: TestApp, gmailId: string, cls = "application_received") {
  const m = mail(t, gmailId);
  t.repos.mail.setResult(
    m.id,
    {
      status: "review",
      class: cls,
      confidence: 0.9,
      result: { summary: "Candidatura recebida", review: "duas vagas parecidas", company: "Acme" },
    },
    AT,
  );
  return m;
}

function inQuarantine(t: TestApp, gmailId: string) {
  const m = mail(t, gmailId, "rh@acme-vagas.example");
  t.repos.mail.setAssessment(
    m.id,
    {
      status: "quarantine",
      class: "candidate",
      riskLevel: "high",
      riskReasons: ["domínio parecido"],
    },
    AT,
  );
  return m;
}

describe("F14/M5 · /api/mail/review", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("lista revisão e quarentena com o motivo, o resumo e o link do Gmail", async () => {
    t = makeTestApp();
    inReview(t, "r1");
    inQuarantine(t, "q1");
    const r = (await (await t.api("/api/mail/review")).json()) as {
      review: Array<Record<string, unknown>>;
      quarantine: Array<Record<string, unknown>>;
    };
    expect(r.review).toHaveLength(1);
    expect(r.review[0]).toMatchObject({
      gmailId: "r1",
      class: "application_received",
      reason: "duas vagas parecidas",
      summary: "Candidatura recebida",
      from: "RH Acme <rh@acme.example>",
      mailUrl: "https://mail.google.com/mail/u/0/#all/r1",
    });
    expect(r.quarantine).toHaveLength(1);
    expect(r.quarantine[0]).toMatchObject({ gmailId: "q1", riskReasons: ["domínio parecido"] });
  });

  it("ignorar: sai da lista; na quarentena o remetente ganha uma recusa; fora da revisão 404", async () => {
    t = makeTestApp();
    const r = inReview(t, "r1");
    const q = inQuarantine(t, "q1");
    expect((await t.api(`/api/mail/${r.id}/ignore`, req("POST", {}))).status).toBe(200);
    expect((await t.api(`/api/mail/${q.id}/ignore`, req("POST", {}))).status).toBe(200);
    expect(t.repos.mail.get(r.id)?.status).toBe("ignored");
    expect(t.repos.mail.get(q.id)?.status).toBe("ignored");
    const sender = t.repos.mailSenders.list().find((s) => s.value === "rh@acme-vagas.example");
    expect(sender).toMatchObject({ rejectedCount: 1 });
    expect((await t.api(`/api/mail/${r.id}/ignore`, req("POST", {}))).status).toBe(404);
    // ignorar a quarentena confirma a suspeita: a etiqueta narnia-jobs/suspeito fica no Gmail
    t.repos.mail.setSuspectLabel([q.id], true, AT);
    expect(t.repos.mail.suspectToRemove(10).map((m) => m.id)).not.toContain(q.id);
  });

  it("escolher a vaga: guarda a vaga forçada, volta à fila e roda a leitura; vaga inexistente 404; alerta 422", async () => {
    t = makeTestApp();
    const r = inReview(t, "r1");
    const posting = t.repos.postings.create({ title: "Dev Backend", company: "Acme" });
    expect(
      (await t.api(`/api/mail/${r.id}/apply`, req("POST", { postingId: "nao-existe" }))).status,
    ).toBe(404);
    const ok = await t.api(`/api/mail/${r.id}/apply`, req("POST", { postingId: posting.id }));
    expect(ok.status).toBe(202);
    const after = t.repos.mail.get(r.id);
    expect(after?.status).toBe("pending");
    expect(after?.class).toBe("application_received");
    expect(after?.result).toMatchObject({ forcedPostingId: posting.id, company: "Acme" });
    expect(t.queue.tasks.at(-1)).toMatchObject({ queue: "scheduled", key: "mail.sync" });
    const archived = t.repos.postings.create({ title: "Antiga", company: "Acme" });
    t.repos.postings.setArchived(archived.id, { reason: "other", note: null });
    const r3 = inReview(t, "r3");
    expect(
      (await t.api(`/api/mail/${r3.id}/apply`, req("POST", { postingId: archived.id }))).status,
    ).toBe(422);
    // M6: atualização, convite e contato também se ligam a uma vaga; alerta não
    const u = inReview(t, "u1", "job_alert");
    expect(
      (await t.api(`/api/mail/${u.id}/apply`, req("POST", { postingId: posting.id }))).status,
    ).toBe(422);
  });

  it("processar a quarentena mesmo assim: volta para a leitura sem nova avaliação de risco; fora dela 404", async () => {
    t = makeTestApp();
    const q = inQuarantine(t, "q1");
    expect((await t.api(`/api/mail/${q.id}/process`, req("POST", {}))).status).toBe(202);
    const after = t.repos.mail.get(q.id);
    expect(after).toMatchObject({ status: "pending", class: "unknown", riskLevel: "neutral" });
    expect(after?.riskReasons).toContain("liberado por você na quarentena");
    expect(t.repos.mail.unassessed(10).map((m) => m.id)).not.toContain(q.id);
    expect(t.repos.mail.toDigest(10).map((m) => m.id)).toContain(q.id);
    expect(t.queue.tasks.at(-1)).toMatchObject({ key: "mail.sync" });
    expect((await t.api(`/api/mail/${q.id}/process`, req("POST", {}))).status).toBe(404);
  });

  it("aplicar mesmo assim (remetente sem confiança): confirma a ligação automática; vaga e confirmação juntas: 400", async () => {
    t = makeTestApp();
    const r = inReview(t, "r1");
    const ok = await t.api(`/api/mail/${r.id}/apply`, req("POST", { confirm: true }));
    expect(ok.status).toBe(202);
    expect(t.repos.mail.get(r.id)?.result).toMatchObject({ confirmed: true });
    const r2 = inReview(t, "r2");
    expect((await t.api(`/api/mail/${r2.id}/apply`, req("POST", {}))).status).toBe(400);
    expect(
      (await t.api(`/api/mail/${r2.id}/apply`, req("POST", { confirm: true, postingId: "x" })))
        .status,
    ).toBe(400);
  });
});
