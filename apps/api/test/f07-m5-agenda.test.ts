import { applyToPosting, seedFixture } from "@narnia-jobs/core";
import type {
  JobApplicationEvent,
  JobApplicationFunnel,
  JobApplicationUpcoming,
} from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F07/M5 · agenda pela API: criar no fuso da pessoa, editar (SEQUENCE), `.ics`, lembretes e funil. */
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
type Body = { event: JobApplicationEvent; events: JobApplicationEvent[]; error: { code: string } };
const body = async <T = Body>(r: Response | Promise<Response>) => (await (await r).json()) as T;

function seed(t: TestApp) {
  const { profileId } = seedFixture(t.repos, "engineer");
  const posting = t.repos.postings.create(
    { company: "Acme", title: "Backend" },
    { source: "user" },
  );
  const doc = t.repos.documents.create({
    kind: "cv",
    profileId,
    postingId: posting.id,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const v = t.repos.documents.addVersion(doc.id, {
    source: "agent",
    instructions: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
  });
  t.repos.documents.updateVersion(v.id, { status: "ready" });
  return applyToPosting(t.repos, {
    postingId: posting.id,
    cvVersionId: v.id,
    appliedOn: "2026-10-20",
  });
}

const future = () => {
  const d = new Date(Date.now() + 3 * 3_600_000);
  return d.toISOString().slice(0, 16);
};

describe("F07/M5 · API da agenda", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("cria, lista, edita (SEQUENCE), baixa o .ics e apaga", async () => {
    t = makeTestApp();
    const app = seed(t);
    const res = await t.api(
      `/api/job-applications/${app.id}/events`,
      json({
        kind: "interview",
        title: "Entrevista técnica",
        startsLocal: "2026-10-29T14:00",
        timezone: "America/Sao_Paulo",
        durationMin: 60,
        link: "https://meet.example/abc",
      }),
    );
    expect(res.status).toBe(201);
    const { event } = await body(res);
    expect(event.startsAt).toBe("2026-10-29T17:00:00.000Z");
    const edited = await body(
      t.api(
        `/api/job-applications/${app.id}/events/${event.id}`,
        json({ startsLocal: "2026-10-29T15:00", timezone: "America/Sao_Paulo" }, "PATCH"),
      ),
    );
    expect(edited.event.icsSequence).toBe(1);
    const ics = await t.api(
      `/api/job-applications/${app.id}/events/${event.id}/calendar.ics?origin=${encodeURIComponent("http://127.0.0.1:5174")}`,
    );
    expect(ics.headers.get("content-type")).toMatch(/^text\/calendar/);
    const text = await ics.text();
    expect(text).toContain("DTSTART:20261029T180000Z");
    expect(text).toContain("SEQUENCE:1");
    expect(text.replace(/\r\n /g, "")).toContain(`http://127.0.0.1:5174/candidaturas/${app.id}`);
    const list = await body(t.api(`/api/job-applications/${app.id}/events`));
    expect(list.events).toHaveLength(1);
    expect(
      (await t.api(`/api/job-applications/${app.id}/events/${event.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
  });

  it("hora inválida, link que não é http e etapa de fora: 400", async () => {
    t = makeTestApp();
    const app = seed(t);
    const base = { kind: "interview", title: "X", timezone: "America/Sao_Paulo" };
    for (const extra of [
      { startsLocal: "29/10 14h" },
      { startsLocal: "2026-10-29T14:00", link: "javascript:alert(1)" },
      { startsLocal: "2026-10-29T14:00", stageId: "nao-existe" },
    ])
      expect(
        (await t.api(`/api/job-applications/${app.id}/events`, json({ ...base, ...extra }))).status,
      ).toBe(400);
  });

  it("lembretes e funil", async () => {
    t = makeTestApp();
    const app = seed(t);
    await t.api(
      `/api/job-applications/${app.id}/events`,
      json({ kind: "test", title: "Case", startsLocal: future(), timezone: "UTC" }),
    );
    const u = await body<JobApplicationUpcoming>(t.api("/api/job-applications/upcoming?hours=24"));
    expect(u.upcoming.map((x) => x.event.title)).toEqual(["Case"]);
    const f = await body<JobApplicationFunnel>(t.api("/api/job-applications/funnel"));
    expect(f.total).toBe(1);
    expect(f.columns.find((c) => c.column === "applied")?.now).toBe(1);
  });
});
