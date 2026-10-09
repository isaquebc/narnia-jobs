import { reconcileRun } from "../ingest/review";
import type { Processor } from "../pipeline";

/** Etapa 7 (F03): compara as propostas do CV/texto com os fatos que o usuário já tem. */
export const reconcileStage: Processor = async (env, _ctx, deps) => {
  const counts = reconcileRun(deps, env.run.id);
  return { skipped: false, summary: { ...counts } };
};
