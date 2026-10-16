import type { SettingsRepo } from "../db/repos/settings";

/**
 * Concorrência das filas (F05 §2.7, infraestrutura de jobs caros; sugestão do dono na F02-1): quantos jobs de cada fila
 * rodam ao mesmo tempo, em Configurações. Roda na máquina da pessoa, então o limite é dela; o worker aplica em tempo de
 * execução (sem reiniciar). De 1 a 4 por fila.
 */
export const WORKER_QUEUES = ["ingest", "ocr", "extract"] as const;
export type WorkerQueue = (typeof WORKER_QUEUES)[number];
export type WorkerConcurrency = Record<WorkerQueue, number>;

export const WORKER_CONCURRENCY_DEFAULTS: WorkerConcurrency = { ingest: 2, ocr: 1, extract: 2 };
export const WORKER_CONCURRENCY_MIN = 1;
export const WORKER_CONCURRENCY_MAX = 4;
const KEY = "workers.concurrency";

const clamp = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isInteger(n)
    ? Math.min(WORKER_CONCURRENCY_MAX, Math.max(WORKER_CONCURRENCY_MIN, n))
    : fallback;

export function resolveConcurrency(settings: SettingsRepo): WorkerConcurrency {
  const saved = settings.get<Partial<Record<string, unknown>>>(KEY) ?? {};
  return Object.fromEntries(
    WORKER_QUEUES.map((q) => [q, clamp(saved[q], WORKER_CONCURRENCY_DEFAULTS[q])]),
  ) as WorkerConcurrency;
}

export function saveConcurrency(
  settings: SettingsRepo,
  patch: Partial<WorkerConcurrency>,
): WorkerConcurrency {
  const next = { ...resolveConcurrency(settings), ...patch };
  settings.set(
    KEY,
    Object.fromEntries(
      WORKER_QUEUES.map((q) => [q, clamp(next[q], WORKER_CONCURRENCY_DEFAULTS[q])]),
    ),
  );
  return resolveConcurrency(settings);
}
