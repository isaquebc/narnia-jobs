import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { healStuckDocuments, STUCK_DOCUMENT_ERROR } from "../../src/documents/heal";
import { DOCUMENT_TASKS } from "../../src/documents/tasks";
import type { QueueStateFn } from "../../src/ingest/heal";
import { STALE_AFTER_MS } from "../../src/ingest/heal";
import { enqueueTask } from "../../src/jobs/tasks";
import { seedFixture } from "../../src/testing/profile-fixtures";
import { CV_SHORT } from "./fixtures/cv";

const fakeQueues = () => {
  const q = { add: async () => {} };
  return { ingest: q, ocr: q, extract: q };
};

async function setup() {
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
  const add = async (status: "reviewing" | "ready" = "reviewing", withJob = true) => {
    const v = r.documents.addVersion(doc.id, {
      source: "template",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    r.documents.updateVersion(v.id, { status, content: CV_SHORT });
    if (!withJob) return { version: v, jobId: null };
    const { job } = await enqueueTask({
      queues: fakeQueues(),
      repos: r,
      queue: "extract",
      type: DOCUMENT_TASKS.render,
      key: v.id,
      payload: { documentId: doc.id, versionId: v.id },
    });
    r.documents.updateVersion(v.id, { jobId: job.id });
    r.jobs.applyEvent({ jobId: job.id, type: "active", at: new Date().toISOString() });
    return { version: v, jobId: job.id };
  };
  return { r, doc, add };
}

const later = () => new Date(Date.now() + STALE_AFTER_MS + 60_000);
const queueSays =
  (state: Awaited<ReturnType<QueueStateFn>>["state"], failedReason: string | null = null) =>
  async () => ({ state, failedReason });

/**
 * Versão presa (dono, 2026-10-19): o worker reiniciou no meio da montagem e a versão ficou em "Revisando" para sempre,
 * sem "Tentar de novo". O verificador periódico confere a fila e encerra a versão com erro quando a tarefa morreu.
 */
describe("F05 core · versões de documento presas", () => {
  it("tarefa viva na fila (esperando ou rodando): não mexe", async () => {
    const s = await setup();
    const { version } = await s.add();
    for (const st of ["active", "waiting", "delayed"] as const)
      expect(await healStuckDocuments(s.r, queueSays(st), later())).toEqual([]);
    expect(s.r.documents.versionById(version.id)?.status).toBe("reviewing");
  });

  it("tarefa sumiu da fila e sem sinal há mais de 2 min: versão vira erro e o espelho do job, falho", async () => {
    const s = await setup();
    const { version, jobId } = await s.add();
    const healed = await healStuckDocuments(s.r, queueSays("missing"), later());
    expect(healed.map((v) => v.id)).toEqual([version.id]);
    expect(s.r.documents.versionById(version.id)).toMatchObject({
      status: "error",
      error: STUCK_DOCUMENT_ERROR,
    });
    expect(s.r.jobs.get(jobId as string)?.status).toBe("error");
  });

  it("sumiu há pouco (o evento de concluído pode estar a caminho): espera", async () => {
    const s = await setup();
    const { version } = await s.add();
    expect(await healStuckDocuments(s.r, queueSays("missing"), new Date())).toEqual([]);
    expect(s.r.documents.versionById(version.id)?.status).toBe("reviewing");
  });

  it("a fila diz que falhou: erro com o motivo da fila, na hora", async () => {
    const s = await setup();
    const { version } = await s.add();
    await healStuckDocuments(s.r, queueSays("failed", "job stalled more than allowable limit"));
    expect(s.r.documents.versionById(version.id)?.status).toBe("error");
  });

  it("versão em andamento sem job vivo no espelho (nunca enfileirada) e parada: erro", async () => {
    const s = await setup();
    const { version } = await s.add("reviewing", false);
    expect(await healStuckDocuments(s.r, queueSays("active"), new Date())).toEqual([]);
    const healed = await healStuckDocuments(s.r, queueSays("active"), later());
    expect(healed.map((v) => v.id)).toEqual([version.id]);
    expect(s.r.documents.versionById(version.id)?.status).toBe("error");
  });

  it("versões prontas não entram", async () => {
    const s = await setup();
    await s.add("ready");
    expect(await healStuckDocuments(s.r, queueSays("missing"), later())).toEqual([]);
  });
});
