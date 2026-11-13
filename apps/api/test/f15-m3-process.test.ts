import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F15/M3 · "Usar estas fases": aplica as fases que um e-mail sugeriu e as mostra na atividade da candidatura. */
const AT = "2026-11-12T15:40:00.000Z";

describe("F15/M3 · fases do processo pelo e-mail", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("mostra a sugestão na atividade, aplica com a fase atual e some; sem sugestão 409; inexistente 404", async () => {
    t = makeTestApp();
    const p = t.repos.postings.create({ company: "Acme", title: "Dev" } as never, {
      source: "user",
    });
    const app = t.repos.jobApplications.create({
      postingId: p.id,
      profileId: null,
      cvVersionId: null,
      coverLetterVersionId: null,
      appliedOn: "2026-11-01",
      stages: ["Triagem", "Case"],
    });
    const { record } = t.repos.mail.insert(
      {
        gmailId: "g1",
        threadId: null,
        fromAddr: "rh@acme.example",
        fromName: "RH",
        replyTo: null,
        subject: "Próxima etapa",
        receivedAt: AT,
        size: 1,
        labels: [],
        rawPath: "mail/g1.eml",
      },
      AT,
    );
    const proc = { stages: ["Inscrição", "Pré-seleção", "Entrevista"], current: "Pré-seleção" };
    t.repos.mail.setResult(
      record.id,
      {
        status: "done",
        class: "update",
        confidence: 95,
        result: { applicationId: app.id, postingId: p.id, processSuggestion: proc },
      },
      AT,
    );
    const act = (await (await t.api(`/api/job-applications/${app.id}/mail-activity`)).json()) as {
      mails: Array<{ processSuggestion: unknown }>;
    };
    expect(act.mails[0]?.processSuggestion).toEqual(proc);

    const r = await t.api(`/api/mail/${record.id}/apply-process`, { method: "POST" });
    expect(r.status).toBe(200);
    const { application } = (await r.json()) as {
      application: { stages: Array<{ id: string; name: string }>; currentStageId: string };
    };
    expect(application.stages.map((s) => s.name)).toEqual(proc.stages);
    expect(application.stages.find((s) => s.id === application.currentStageId)?.name).toBe(
      "Pré-seleção",
    );
    expect((await t.api(`/api/mail/${record.id}/apply-process`, { method: "POST" })).status).toBe(
      409,
    );
    expect((await t.api("/api/mail/nao/apply-process", { method: "POST" })).status).toBe(404);
  });
});
