import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, uploadFixture } from "./helpers";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M4/api jobs: listar, cancelar, tentar de novo; resumo de uso", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  async function newRunWithJob() {
    const { body: file } = await uploadFixture(t);
    const ing = (await (await t.api("/api/ingestions", json({ fileId: file.id }))).json()) as {
      id: string;
      jobs: Array<{ id: string }>;
    };
    return { runId: ing.id, jobId: ing.jobs[0]?.id as string };
  }

  it("GET /api/jobs lista do espelho; GET /api/jobs/:id 404 quando não existe", async () => {
    t = makeTestApp();
    const { jobId } = await newRunWithJob();
    const list = (await (await t.api("/api/jobs")).json()) as { jobs: Array<{ id: string }> };
    expect(list.jobs.map((j) => j.id)).toContain(jobId);
    expect((await t.api(`/api/jobs/${jobId}`)).status).toBe(200);
    expect((await t.api("/api/jobs/nope")).status).toBe(404);
  });

  it("cancelar job na fila → cancelled no espelho e run com erro de cancelamento; cancelar job concluído → 409; ativo → 409", async () => {
    t = makeTestApp();
    const { runId, jobId } = await newRunWithJob();
    const res = await t.api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(t.repos.jobs.get(jobId)?.status).toBe("cancelled");
    expect(t.queue.cancelled).toEqual([jobId]);
    expect(t.repos.ingestionRuns.get(runId)?.status).toBe("error");
    expect(t.repos.ingestionRuns.get(runId)?.error).toMatch(/cancelad/i);
    expect((await t.api(`/api/jobs/${jobId}/cancel`, { method: "POST" })).status).toBe(409);

    const other = await newRunWithJob();
    t.queue.cancelResult = "active";
    expect((await t.api(`/api/jobs/${other.jobId}/cancel`, { method: "POST" })).status).toBe(409);
    expect(t.repos.jobs.get(other.jobId)?.status).toBe("queued");
  });

  it("tentar de novo só para job em erro: volta a queued, run volta a running e o adaptador é chamado; job queued → 409", async () => {
    t = makeTestApp();
    const { runId, jobId } = await newRunWithJob();
    expect((await t.api(`/api/jobs/${jobId}/retry`, { method: "POST" })).status).toBe(409);
    t.repos.jobs.applyEvent({ jobId, type: "active", at: new Date().toISOString() });
    t.repos.jobs.applyEvent({ jobId, type: "failed", at: new Date().toISOString(), error: "boom" });
    t.repos.ingestionRuns.setStatus(runId, "error", { error: "boom" });
    const res = await t.api(`/api/jobs/${jobId}/retry`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(t.repos.jobs.get(jobId)?.status).toBe("queued");
    expect(t.repos.jobs.get(jobId)?.error).toBeNull();
    expect(t.queue.retried).toEqual([jobId]);
    expect(t.repos.ingestionRuns.get(runId)?.status).toBe("running");
  });

  it("GET /api/usage/summary soma por categoria e por modelo", async () => {
    t = makeTestApp();
    const base = {
      origin: "narnia" as const,
      jobId: null,
      sessionId: null,
      cacheRead: 0,
      cacheWrite: 0,
      costUsdEst: 0,
    };
    t.repos.usageEvents.insert({
      ...base,
      id: "u1",
      ts: new Date().toISOString(),
      category: "ingest.facts",
      model: "haiku",
      inputTokens: 100,
      outputTokens: 10,
    });
    t.repos.usageEvents.insert({
      ...base,
      id: "u2",
      ts: new Date().toISOString(),
      category: "ingest.digest",
      model: "sonnet",
      inputTokens: 50,
      outputTokens: 5,
    });
    const body = (await (await t.api("/api/usage/summary")).json()) as {
      totalTokens: number;
      byCategory: Record<string, number>;
      byModel: Record<string, number>;
    };
    expect(body.totalTokens).toBe(165);
    expect(body.byCategory).toEqual({ "ingest.facts": 110, "ingest.digest": 55 });
    expect(body.byModel).toEqual({ haiku: 110, sonnet: 55 });
  });
});
