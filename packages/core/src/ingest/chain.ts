import type { Job } from "@narnia-jobs/shared";
import { nowUtc } from "@narnia-jobs/shared";
import type { Repos } from "../db";

/**
 * Cadeia de jobs da ingestão (F01 §2.5). Cada etapa é um job BullMQ com id determinístico `(run, etapa)`;
 * a tabela `job` é o espelho durável. O plano depende do tipo de arquivo e das opções (OCR, leitura pelo modelo).
 */
export type QueueName = "ingest" | "ocr" | "extract";

export type StageName =
  | "ingest.read_text"
  | "ocr.pages"
  | "extract.read_doc"
  | "ingest.consolidate"
  | "extract.facts"
  | "extract.digest";

export interface StageJobData {
  runId: string;
  stage: StageName;
}

export const STAGES: Record<StageName, { queue: QueueName; order: number; label: string }> = {
  "ingest.read_text": { queue: "ingest", order: 1, label: "Leitura da camada de texto" },
  "ocr.pages": { queue: "ocr", order: 2, label: "OCR das páginas" },
  "extract.read_doc": { queue: "extract", order: 3, label: "Leitura do documento pelo modelo" },
  "ingest.consolidate": { queue: "ingest", order: 4, label: "Consolidação das leituras" },
  "extract.facts": { queue: "extract", order: 5, label: "Extração de fatos" },
  "extract.digest": { queue: "extract", order: 6, label: "Registro de contexto" },
};

export const STAGE_ORDER = (Object.keys(STAGES) as StageName[]).sort(
  (a, b) => STAGES[a].order - STAGES[b].order,
);

export interface PlanInput {
  isPdf: boolean;
  options: { ocr: boolean; modelRead: boolean };
}

/** OCR e leitura pelo modelo só para PDF (F01-3); texto livre, MD e DOCX só passam pela camada de texto. */
export function planStages(input: PlanInput): StageName[] {
  return STAGE_ORDER.filter((stage) => {
    if (stage === "ocr.pages") return input.isPdf && input.options.ocr;
    if (stage === "extract.read_doc") return input.isPdf && input.options.modelRead;
    return true;
  });
}

/** Ids customizados da BullMQ não podem conter ':'; usamos `__`. */
export function stageJobId(runId: string, stage: StageName): string {
  return `${runId}__${stage}`;
}

export function nextStage(plan: StageName[], current: StageName): StageName | null {
  const idx = plan.indexOf(current);
  if (idx < 0) return null;
  return plan[idx + 1] ?? null;
}

/** Opções padrão dos jobs: concluídos saem da fila (reenfileirar pelo mesmo id); falhos ficam para "tentar de novo". */
export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: false,
  attempts: 2,
  backoff: { type: "exponential", delay: 5_000 },
} as const;

/** Subconjunto da `Queue` da BullMQ usado aqui (injetável). */
export interface QueueLike {
  add(name: string, data: StageJobData, opts: { jobId: string }): Promise<unknown>;
}

export interface EnqueueStageInput {
  queues: Record<QueueName, QueueLike>;
  repos: Repos;
  runId: string;
  stage: StageName;
  profileId?: string | null;
  at?: string;
}

/** Enfileira a etapa na fila certa e registra o espelho `queued` (idempotente: mesmo jobId não duplica). */
export async function enqueueStage(input: EnqueueStageInput): Promise<Job> {
  const { queue } = STAGES[input.stage];
  const id = stageJobId(input.runId, input.stage);
  const at = input.at ?? nowUtc();
  const data: StageJobData = { runId: input.runId, stage: input.stage };
  const job = input.repos.jobs.upsertQueued({
    id,
    queue,
    type: input.stage,
    parentId: input.runId,
    profileId: input.profileId ?? null,
    payload: { ...data },
    stage: input.stage,
    at,
  });
  await input.queues[queue].add(input.stage, data, { jobId: id });
  return job;
}
