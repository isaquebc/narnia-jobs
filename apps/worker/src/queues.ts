/** Filas BullMQ de F01 (§2.5). A conexão e a classe Queue são injetáveis para testes sem Redis. */
export const QUEUE_NAMES = ["ingest", "ocr", "extract"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface QueueLike {
  readonly name: string;
}

export interface QueueOptionsLike {
  connection: unknown;
  prefix: string;
  defaultJobOptions?: Record<string, unknown>;
}

export type QueueCtor<Q extends QueueLike> = new (name: string, opts: QueueOptionsLike) => Q;

export interface CreateQueuesOptions<Q extends QueueLike> {
  connection: unknown;
  prefix?: string;
  QueueCtor: QueueCtor<Q>;
  defaultJobOptions?: Record<string, unknown>;
}

export { DEFAULT_JOB_OPTIONS } from "@narnia-jobs/core";

import { DEFAULT_JOB_OPTIONS } from "@narnia-jobs/core";

export function createQueues<Q extends QueueLike>(
  options: CreateQueuesOptions<Q>,
): Record<QueueName, Q> {
  const prefix = options.prefix ?? "narnia";
  const entries = QUEUE_NAMES.map((name) => [
    name,
    new options.QueueCtor(name, {
      connection: options.connection,
      prefix,
      defaultJobOptions: options.defaultJobOptions ?? { ...DEFAULT_JOB_OPTIONS },
    }),
  ]);
  return Object.fromEntries(entries) as Record<QueueName, Q>;
}
