import {
  addressForm,
  aliasBriefIds,
  assembleMotivations,
  buildCvBrief,
  MOTIVATION_SUGGESTIONS,
  POSTING_MODEL_DEFAULTS,
  recordUsage,
  resolveModel,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { TaskHandler } from "../tasks";

/**
 * Motivações do perfil (F12-23): o Sonnet sugere frases pelo histórico (resumo do perfil, sem vaga), no tratamento do
 * cadastro, sem repetir as aceitas nem as recusadas; a conferência por código tira as repetidas e guarda as novas como
 * `suggested`, para a pessoa decidir. `count` vem no pedido de uma no lugar de uma recusada.
 */
export const profileMotivations: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const profileId = String(data.payload.profileId ?? "");
  if (!repos.profiles.get(profileId)) return { skipped: "profile_not_found" };
  const existing = repos.profileMotivations.list(profileId);
  const count = Number(data.payload.count ?? MOTIVATION_SUGGESTIONS);
  await ctx.progress(20, "brief");
  const { brief } = buildCvBrief(repos, {
    kind: "cv",
    profileId,
    postingId: null,
    locale: "pt-BR",
    instructions: null,
    previousIssues: [],
  });
  const aliases = aliasBriefIds(brief);
  const m = resolveModel(
    repos.settings,
    "application_answer",
    POSTING_MODEL_DEFAULTS.application_answer,
  );
  await ctx.progress(40, "suggesting");
  const r = await deps.provider.profileMotivations({
    brief: aliases.brief,
    address: addressForm(repos.users.get()?.pronouns),
    // as sugestões ainda sem decisão também: o modelo não deve repeti-las
    accepted: existing.filter((x) => x.status !== "refused").map((x) => x.text),
    refused: existing.filter((x) => x.status === "refused").map((x) => x.text),
    count,
    model: m,
  });
  recordUsage(
    repos,
    deps.dataDir,
    usageFromSdkResult(r.sdk, { category: "profile.motivations", model: m, jobId: ctx.jobId }),
  );
  const texts = assembleMotivations(r.output, existing, count);
  for (const text of texts)
    repos.profileMotivations.add({ profileId, text, status: "suggested", source: "model" });
  await deps.publish({ type: "profile.motivations.updated", profileId });
  return { profileId, suggested: texts.length };
};
