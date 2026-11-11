import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14/M3 · lista de remetentes (F14-13) e "processar este e-mail agora" (extensão): confiar e bloquear por endereço
 * ou domínio; domínio de webmail só por endereço; sugestões pelo histórico; confiar mostra quantos estão em
 * quarentena e reprocessar volta esses e-mails para a avaliação; pedido da extensão vai para a próxima leitura.
 */
const req = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const AT = "2026-11-11T12:00:00.000Z";

describe("F14/M3 · /api/mail/senders e /api/mail/process", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("confiar e bloquear; webmail como domínio dá 422; valor inválido 400; remover volta ao automático", async () => {
    t = makeTestApp();
    const ok = await t.api(
      "/api/mail/senders",
      req("PUT", { value: "@Acme.example", override: "trusted" }),
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { trusted: Array<{ value: string; overrideOrigin: string }> };
    expect(body.trusted.map((s) => [s.value, s.overrideOrigin])).toEqual([
      ["@acme.example", "manual"],
    ]);
    await t.api(
      "/api/mail/senders",
      req("PUT", { value: "golpe@fake.example", override: "blocked", origin: "extension" }),
    );
    expect(
      (await t.api("/api/mail/senders", req("PUT", { value: "@gmail.com", override: "trusted" })))
        .status,
    ).toBe(422);
    expect(
      (await t.api("/api/mail/senders", req("PUT", { value: "não é", override: "trusted" })))
        .status,
    ).toBe(400);
    const list = (await (await t.api("/api/mail/senders")).json()) as {
      blocked: Array<{ value: string }>;
    };
    expect(list.blocked.map((s) => s.value)).toEqual(["golpe@fake.example"]);
    const del = (await (
      await t.api(`/api/mail/senders/${encodeURIComponent("@acme.example")}`, req("DELETE"))
    ).json()) as {
      trusted: unknown[];
    };
    expect(del.trusted).toEqual([]);
  });

  it("sugestões: remetente com 3 e-mails bons e nenhuma recusa, que não é plataforma", async () => {
    t = makeTestApp();
    for (let i = 0; i < 3; i++) {
      t.repos.mailSenders.bump("rh@acme.example", "ok", AT);
      t.repos.mailSenders.bump("jobs-noreply@linkedin.com", "ok", AT);
    }
    t.repos.mailSenders.bump("x@globex.example", "ok", AT);
    const s = (await (await t.api("/api/mail/senders")).json()) as {
      suggestions: Array<{ value: string }>;
    };
    expect(s.suggestions.map((x) => x.value)).toEqual(["rh@acme.example"]);
  });

  it("confiar num remetente em quarentena: conta, e reprocessar volta os e-mails para a avaliação e roda a leitura", async () => {
    t = makeTestApp();
    const { record } = t.repos.mail.insert(
      {
        gmailId: "q1",
        threadId: null,
        fromAddr: "rh@acme.example",
        fromName: "RH",
        replyTo: null,
        subject: "Vaga",
        receivedAt: AT,
        size: 1,
        labels: [],
        rawPath: "mail/q1.eml",
      },
      AT,
    );
    t.repos.mail.setAssessment(
      record.id,
      { status: "quarantine", class: "candidate", riskLevel: "high", riskReasons: ["x"] },
      AT,
    );
    const put = (await (
      await t.api("/api/mail/senders", req("PUT", { value: "@acme.example", override: "trusted" }))
    ).json()) as { quarantined: number };
    expect(put.quarantined).toBe(1);
    const r = (await (
      await t.api(`/api/mail/senders/${encodeURIComponent("@acme.example")}/reprocess`, req("POST"))
    ).json()) as { reprocessed: number };
    expect(r.reprocessed).toBe(1);
    expect(t.repos.mail.get(record.id)).toMatchObject({
      status: "pending",
      class: null,
      riskLevel: null,
    });
    expect(t.queue.tasks.at(-1)).toMatchObject({ queue: "scheduled", key: "mail.sync" });
  });

  it("processar agora: guarda o id para a próxima leitura e roda; e-mail já lido responde known; id inválido 400", async () => {
    t = makeTestApp();
    const r = await t.api("/api/mail/process", req("POST", { gmailId: "18c2f0a1b2c3d4e5" }));
    expect(r.status).toBe(202);
    expect(t.repos.settings.get("mail.forceIds")).toEqual(["18c2f0a1b2c3d4e5"]);
    expect(t.queue.tasks.at(-1)).toMatchObject({
      key: "mail.sync",
      payload: { trigger: "manual" },
    });
    expect((await t.api("/api/mail/process", req("POST", { gmailId: "<script>" }))).status).toBe(
      400,
    );
  });

  it("revisão #11: confiar ou bloquear o próprio endereço (a resposta da pessoa no Gmail) dá 422", async () => {
    t = makeTestApp();
    const { writeGmailToken } = await import("@narnia-jobs/core");
    writeGmailToken(t.dataDir, {
      refreshToken: "r",
      scope: "s",
      email: "Eu@Example.com",
      connectedAt: AT,
    });
    const r = await t.api(
      "/api/mail/senders",
      req("PUT", { value: "eu@example.com", override: "trusted" }),
    );
    expect(r.status).toBe(422);
  });

  it("revisão #14: remover um endereço com % não quebra", async () => {
    t = makeTestApp();
    await t.api("/api/mail/senders", req("PUT", { value: "a%b@x.example", override: "blocked" }));
    const r = await t.api(
      `/api/mail/senders/${encodeURIComponent("a%b@x.example")}`,
      req("DELETE"),
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { blocked: unknown[] }).blocked).toEqual([]);
  });
});
