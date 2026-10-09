import { reviewCheckRun } from "../ingest/review";
import type { Processor } from "../pipeline";

/** Etapa 8 (F03): confere a evidência de cada proposta antes da revisão. */
export const reviewCheckStage: Processor = async (env, ctx, deps) => {
  const counts = await reviewCheckRun(deps, env.run.id, ctx.jobId);
  return { skipped: false, summary: counts };
};
