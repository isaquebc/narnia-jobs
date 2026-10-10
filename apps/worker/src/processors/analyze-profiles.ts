import {
  buildAnalyzeInput,
  notifyAnalysisDone,
  recordUsage,
  resolveModel,
  syncSuggestionNotifications,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { TaskHandler } from "../tasks";

/**
 * "Analisar possíveis perfis" (F02 §2.6): todo o histórico vai ao modelo numa chamada; cada sugestão devolvida vira
 * `profile_suggestion` com `source = model` (título já existente ou dispensado é ignorado: `create` devolve null).
 */
export const analyzeProfiles: TaskHandler = async (data, ctx, deps) => {
  await ctx.progress(10);
  const model =
    typeof data.payload.model === "string" && data.payload.model
      ? data.payload.model
      : resolveModel(deps.repos.settings, "analyze", "sonnet");
  const input = buildAnalyzeInput(deps.repos);
  await ctx.progress(25);
  const result = await deps.provider.analyzeProfiles({ ...input, model });
  await ctx.progress(80);
  let created = 0;
  let skipped = 0;
  for (const payload of result.output.suggestions) {
    const stored = deps.repos.suggestions.create({ source: "model", model, payload });
    if (stored) created += 1;
    else skipped += 1;
  }
  recordUsage(
    deps.repos,
    deps.dataDir,
    usageFromSdkResult(result.sdk, { category: "profile.analyze", model, jobId: ctx.jobId }),
  );
  // notificações (F03-10): uma por sugestão nova + "análise concluída", retransmitidas por WS
  const events = [
    ...syncSuggestionNotifications(deps.repos),
    notifyAnalysisDone(deps.repos, ctx.jobId, { created, skipped }),
  ];
  for (const ev of events) {
    await deps.publish({
      type: ev.created ? "notification.created" : "notification.updated",
      notification: ev.notification,
    });
  }
  return { created, skipped, model };
};
