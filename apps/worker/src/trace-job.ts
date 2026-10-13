import type { StageJobData, TaskJobData } from "@narnia-jobs/core";
import { clip, contentTracingEnabled, withSpan } from "@narnia-jobs/shared";

/**
 * Rastro de um job do worker (Phoenix): span CHAIN `job.<etapa>` com os dados do job e o resultado; as chamadas ao
 * modelo feitas dentro dele (leitura do PDF, fatos, digest, GitHub) entram como filhas. As etapas de uma ingestão
 * compartilham `session.id` = id da execução, e o Phoenix as agrupa na aba Sessions.
 */
export function traceJob<T>(
  data: StageJobData | TaskJobData,
  job: { jobId: string; queue: string },
  fn: () => Promise<T>,
): Promise<T> {
  const content = contentTracingEnabled();
  const isTask = "kind" in data && data.kind === "task";
  const runId = isTask ? null : (data as StageJobData).runId;
  return withSpan(
    `job.${isTask ? (data as TaskJobData).type : (data as StageJobData).stage}`,
    {
      "openinference.span.kind": "CHAIN",
      "narnia.job_id": job.jobId,
      "narnia.queue": job.queue,
      ...(runId ? { "session.id": runId, "narnia.run_id": runId } : {}),
      ...(content
        ? { "input.value": clip(JSON.stringify(data)), "input.mime_type": "application/json" }
        : {}),
    },
    async (span) => {
      const out = await fn();
      if (content && out !== undefined)
        span.setAttributes({
          "output.value": clip(JSON.stringify(out) ?? ""),
          "output.mime_type": "application/json",
        });
      return out;
    },
  );
}
