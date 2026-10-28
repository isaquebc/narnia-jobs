import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  applyToPosting,
  contactChain,
  createJobApplicationTools,
} from "../../src/job-applications";
import { createPostingTools } from "../../src/postings/tools";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F07/M6 · tools da skill `candidaturas`: listar (uma linha, com link), ler, mover, marcar a etapa pelo nome, registrar
 * nota e agendar no fuso do usuário (link do Google e .ics); cadeia de contatos pela `posting.contact_add`.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  r.users.upsert({ timezone: "America/Sao_Paulo" });
  const p = r.postings.create({ company: "Acme", title: "Backend Sr" }, { source: "user" });
  const d = r.documents.create({
    kind: "cv",
    profileId,
    postingId: p.id,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const v = r.documents.addVersion(d.id, {
    source: "agent",
    instructions: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
  });
  r.documents.updateVersion(v.id, { status: "ready" });
  const app = applyToPosting(r, { postingId: p.id, cvVersionId: v.id, appliedOn: "2026-10-20" });
  const changed: string[] = [];
  const tools = createJobApplicationTools(r, {
    publicUrl: "http://127.0.0.1:3100",
    changed: (id) => changed.push(id),
  });
  return { r, app, posting: p, tools, changed };
}

describe("F07/M6 · tools das candidaturas", () => {
  it("lista com linha e link; filtra por coluna e busca", async () => {
    const { app, tools } = setup();
    const { items } = await tools["job_application.list"]({});
    expect(items).toEqual([
      {
        id: app.id,
        column: "applied",
        line: expect.stringMatching(/Acme · Backend Sr · Aplicado · aplicou em 20\/10\/2026/),
        url: `/candidaturas/${app.id}`,
      },
    ]);
    expect((await tools["job_application.list"]({ column: "offer" })).items).toEqual([]);
    expect((await tools["job_application.list"]({ query: "acme" })).items).toHaveLength(1);
  });

  it("move (encerrar pede motivo), marca etapa pelo nome e registra nota", async () => {
    const { r, app, tools, changed } = setup();
    await expect(tools["job_application.move"]({ id: app.id, column: "closed" })).rejects.toThrow(
      /motivo/,
    );
    const moved = await tools["job_application.move"]({ id: app.id, column: "in_process" });
    expect(moved.line).toContain("Em processo 1/6");
    const staged = await tools["job_application.set_stage"]({
      id: app.id,
      stage: "entrevista técnica",
    });
    expect(staged.line).toContain("Em processo 4/6");
    await expect(
      tools["job_application.set_stage"]({ id: app.id, stage: "Pair programming" }),
    ).rejects.toThrow(/etapa/i);
    await tools["job_application.add_note"]({ id: app.id, body: "Recrutadora pediu o portfólio" });
    expect(r.jobApplicationEntries.list(app.id)[0]?.body).toBe("Recrutadora pediu o portfólio");
    expect(changed).toContain(app.id);
  });

  it("agenda no fuso do usuário e devolve o link do Google e do .ics; get mostra tudo", async () => {
    const { r, app, tools } = setup();
    const ev = await tools["job_application.schedule"]({
      id: app.id,
      kind: "interview",
      title: "Entrevista técnica",
      startsLocal: "2030-10-29T14:00",
      stage: "Entrevista técnica",
    });
    expect(ev.line).toContain("29/10/2030 14:00 (America/Sao_Paulo)");
    expect(new URL(ev.googleCalendarUrl).searchParams.get("dates")).toBe(
      "20301029T170000Z/20301029T180000Z",
    );
    expect(ev.icsUrl).toBe(
      `http://127.0.0.1:3100/api/job-applications/${app.id}/events/${ev.id}/calendar.ics`,
    );
    const got = await tools["job_application.get"]({ id: app.id });
    expect(got.events.map((e) => e.line)).toEqual([expect.stringContaining("Entrevista técnica")]);
    expect(got.stages.find((s) => s.current)?.name).toBe("Análise de currículo");
    expect(got.documents).toEqual([expect.stringContaining("CV desta vaga · versão 1")]);
    await tools["job_application.set_google_event"]({ eventId: ev.id, googleEventId: "g-123" });
    expect(r.jobApplicationEvents.get(ev.id)?.googleEventId).toBe("g-123");
    const up = await tools["job_application.upcoming"]({ hours: 24 * 14 });
    expect(up.timezone).toBe("America/Sao_Paulo");
  });
});

describe("F07/M6 · cadeia de contatos", () => {
  it("registra em ordem com papel, data e quem indicou; get mostra a cadeia", async () => {
    const { r, app, posting, tools } = setup();
    const pt = createPostingTools(r, {
      ports: { intake: async () => ({ ok: false, code: "x", message: "x" }) },
    });
    await pt["posting.contact_add"]({
      postingId: posting.id,
      name: "Maria Souza",
      origin: "linkedin",
      role: "referral",
      contactedOn: "2026-10-18",
      summary: "Ex-colega, me indicou ao gestor",
    });
    await pt["posting.contact_add"]({
      postingId: posting.id,
      name: "João Lima",
      origin: "email",
      role: "hiring_manager",
      contactedOn: "2026-10-21",
      referredBy: "maria souza",
    });
    await expect(
      pt["posting.contact_add"]({
        postingId: posting.id,
        name: "Ana",
        origin: "other",
        referredBy: "Ninguém",
      }),
    ).rejects.toThrow(/indicou/);
    const chain = contactChain(r.postingContacts.list(posting.id));
    expect(chain.map((c) => c.line)).toEqual([
      "1. Maria Souza · indicação · LinkedIn · 18/10/2026 · Ex-colega, me indicou ao gestor",
      "2. João Lima · gestor(a) · e-mail · 21/10/2026 · indicado(a) por Maria Souza",
    ]);
    const got = await tools["job_application.get"]({ id: app.id });
    expect(got.contacts.map((c) => c.line)).toEqual(chain.map((c) => c.line));
  });
});
