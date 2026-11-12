import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";

/**
 * Migration 0047 (pedido do dono 2026-11-12): a vaga que veio de e-mail ganha a data e a hora em que o e-mail chegou
 * (`sourceRef.receivedAt`); as outras ficam como estão.
 */
describe("migration 0047_posting_mail_received", () => {
  it("vaga do e-mail ganha a data do e-mail; vaga sem e-mail conhecido e vaga da extensão ficam iguais", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0046_mail_retriage" });
    const repos = createRepos(db);
    const at = "2026-11-11T12:00:00.000Z";
    repos.mail.insert(
      {
        gmailId: "g1",
        threadId: "t1",
        fromAddr: "jobalerts-noreply@linkedin.com",
        fromName: "LinkedIn",
        replyTo: null,
        subject: "Vagas",
        receivedAt: "2026-11-10T13:05:00.000Z",
        size: 10,
        labels: [],
        rawPath: "mail/g1.eml",
      },
      at,
    );
    const ref = (gmailId: string) => ({
      gmailId,
      platform: "linkedin",
      mailUrl: null,
      trusted: true,
    });
    const fromMail = repos.postings.create({ company: "Acme", title: "Dev" }, { source: "email" });
    repos.postings.setOrigin(fromMail.id, { source: "email", sourceRef: ref("g1") as never });
    const unknown = repos.postings.create({ company: "Globex", title: "Dev" }, { source: "email" });
    repos.postings.setOrigin(unknown.id, { source: "email", sourceRef: ref("sumiu") as never });
    const ext = repos.postings.create({ company: "Initech", title: "Dev" }, { source: "user" });
    repos.postings.setOrigin(ext.id, { source: "extension" });

    expect(migrate(db).applied).toContain("0047_posting_mail_received");
    const after = createRepos(db);
    expect(after.postings.get(fromMail.id)?.sourceRef).toMatchObject({
      gmailId: "g1",
      receivedAt: "2026-11-10T13:05:00.000Z",
    });
    expect(after.postings.get(unknown.id)?.sourceRef?.receivedAt ?? null).toBeNull();
    expect(after.postings.get(ext.id)?.sourceRef).toBeNull();
  });
});
