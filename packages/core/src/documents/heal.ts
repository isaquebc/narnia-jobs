import type { Job } from "@narnia-jobs/shared";
import { nowUtc } from "@narnia-jobs/shared";
import type { Repos } from "../db/repos";
import type { DocumentVersionRecord } from "../db/repos/documents";
import { type QueueStateFn, STALE_AFTER_MS } from "../ingest/heal";
import { taskOfJob } from "../jobs/tasks";
import { DOCUMENT_TASKS } from "./tasks";

export const STUCK_DOCUMENT_ERROR =
  "A montagem parou no meio (o serviço reiniciou ou a tarefa se perdeu). Use Tentar de novo.";

const LIVE_JOB = new Set<Job["status"]>(["queued", "active", "stalled"]);
const LIVE_QUEUE = new Set(["waiting", "active", "delayed"]);
const TYPES = new Set<string>([DOCUMENT_TASKS.generate, DOCUMENT_TASKS.render]);

/**
 * Versões de documento presas (dono, 2026-10-19): o worker reiniciou no meio da montagem e a versão ficou em
 * "Revisando" para sempre, sem "Tentar de novo". Para cada versão em andamento, a fila é a autoridade: tarefa viva
 * (esperando, rodando, adiada) segue; falha na fila encerra na hora; sumida, ou sem job vivo no espelho, só depois de
 * `STALE_AFTER_MS` sem sinal (o evento de concluído pode estar a caminho). Devolve as versões encerradas com erro.
 */
export async function healStuckDocuments(
  repos: Repos,
  state: QueueStateFn,
  now: Date = new Date(),
): Promise<DocumentVersionRecord[]> {
  const active = repos.documents.listActiveVersions();
  if (active.length === 0) return [];
  const jobs = new Map<string, Job>();
  for (const j of repos.jobs.list({ limit: 1000 })) {
    const t = taskOfJob(j);
    const versionId = t && TYPES.has(t.type) ? t.payload.versionId : null;
    if (typeof versionId === "string" && !jobs.has(versionId)) jobs.set(versionId, j);
  }
  const stale = (...at: Array<string | null | undefined>) =>
    at.every((a) => {
      const t = a ? Date.parse(a) : Number.NaN;
      return !Number.isFinite(t) || now.getTime() - t > STALE_AFTER_MS;
    });
  const healed: DocumentVersionRecord[] = [];
  for (const v of active) {
    const job = jobs.get(v.id);
    if (job && LIVE_JOB.has(job.status)) {
      const s = await state(job);
      if (LIVE_QUEUE.has(s.state)) continue;
      const lost = stale(v.updatedAt, job.updatedAt ?? job.startedAt ?? job.createdAt);
      if (s.state !== "failed" && !lost) continue;
      // o motivo técnico da fila fica no job; a pessoa vê a mensagem em português
      const reason =
        s.state === "failed" ? (s.failedReason ?? STUCK_DOCUMENT_ERROR) : STUCK_DOCUMENT_ERROR;
      repos.jobs.applyEvent({ jobId: job.id, type: "failed", at: nowUtc(), error: reason });
    } else if (!stale(v.updatedAt)) continue;
    healed.push(
      repos.documents.updateVersion(v.id, { status: "error", error: STUCK_DOCUMENT_ERROR }),
    );
  }
  return healed;
}
