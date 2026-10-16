import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { documentUrl, notifyDocumentResult } from "../../src/documents/notify";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** F05/M3 · avisos do documento: pronto (informativo) ou não passou na revisão (alerta), um aberto por documento. */
describe("F05/M3 core · avisos do documento", () => {
  it("reprovado vira alerta; a versão seguinte aprovada resolve o alerta e vira 'pronto'", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    const ids = seedFixture(r, "engineer");
    const doc = r.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: null,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    const failed = notifyDocumentResult(r, doc, false);
    expect(failed.notification).toMatchObject({
      kind: "document.review_failed",
      severity: "warning",
      actionUrl: `/perfis/${ids.profileId}/curriculo`,
    });
    expect(failed.notification.title).toMatch(/^Não passou na revisão: Currículo/);
    expect(r.notifications.countUnresolved()).toBe(1);
    notifyDocumentResult(r, doc, true);
    const open = r.notifications.list();
    expect(open.map((n) => n.kind)).toEqual(["document.ready"]);
    // informativa não conta no sino
    expect(r.notifications.countUnresolved()).toBe(0);
  });

  it("link do documento da vaga leva à vaga com o documento", () => {
    expect(documentUrl({ id: "d1", profileId: "p1", postingId: "v1" })).toBe("/vagas/v1?doc=d1");
  });
});
