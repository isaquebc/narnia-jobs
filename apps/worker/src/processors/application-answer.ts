import {
  aliasBriefIds,
  answerableQuestions,
  assembleAnswers,
  buildCvBrief,
  detectFormLocale,
  POSTING_MODEL_DEFAULTS,
  recordUsage,
  resolveModel,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { TaskHandler } from "../tasks";

/**
 * Respostas sugeridas do formulário (F12/M4, §4.6-3): com a vaga ligada (F12-11), o resumo do CV do perfil (o
 * recomendado pela análise da vaga, se houver) vai com os dados pessoais ao Sonnet; a conferência por código guarda
 * uma versão nova de cada resposta. Sem vaga, não responde (a janela pede para ligar uma).
 */
export const applicationAnswer: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const id = String(data.payload.applicationId ?? "");
  const form = repos.applications.get(id);
  if (!form) return { skipped: "application_not_found" };
  if (!form.postingId) {
    repos.applications.setAnswersStatus(id, "idle");
    await deps.publish({ type: "application.updated", applicationId: id });
    return { skipped: "no_posting" };
  }
  const questions = answerableQuestions(form.questions);
  const profileId =
    repos.jobAnalyses.list(form.postingId)[0]?.recommendedProfileId ??
    form.profileId ??
    repos.profiles.active()?.id ??
    null;
  if (!questions.length || !profileId) {
    repos.applications.setAnswersStatus(id, "ready");
    await deps.publish({ type: "application.updated", applicationId: id });
    return { applicationId: id, answers: 0 };
  }
  try {
    repos.applications.setAnswersStatus(id, "answering");
    await deps.publish({ type: "application.updated", applicationId: id });
    await ctx.progress(20, "brief");
    const locale = detectFormLocale(questions);
    const { brief } = buildCvBrief(repos, {
      kind: "cv",
      profileId,
      postingId: form.postingId,
      locale,
      instructions: null,
      previousIssues: [],
    });
    const aliases = aliasBriefIds(brief);
    const user = repos.users.get();
    const profile = repos.profiles.get(profileId);
    const person = {
      city: user?.city ?? null,
      region: user?.region ?? null,
      country: user?.country ?? null,
      remotePref: user?.remotePref ?? null,
      relocation: user?.relocation ?? null,
      workAuth: user?.workAuth ?? [],
      salary: profile?.salary ?? null,
      contracts: profile?.contractTypes ?? [],
      locations: profile?.locations ?? [],
      availableFrom: profile?.availableFrom ?? null,
    };
    await ctx.progress(40, "answering");
    const m = resolveModel(
      repos.settings,
      "application_answer",
      POSTING_MODEL_DEFAULTS.application_answer,
    );
    const r = await deps.provider.applicationAnswer({
      brief: aliases.brief,
      person,
      locale,
      questions: questions.map((q) => ({
        questionId: q.id,
        question: q.question,
        kind: q.kind,
        options: q.options.map((o) => o.label),
        maxChars: q.maxChars,
        required: q.required,
      })),
      model: m,
    });
    recordUsage(
      repos,
      deps.dataDir,
      usageFromSdkResult(r.sdk, { category: "application.answer", model: m, jobId: ctx.jobId }),
    );
    const answers = assembleAnswers(questions, r.output, aliases.resolve);
    repos.applications.addAnswers(id, answers);
    repos.applications.setAnswersStatus(id, "ready");
    await deps.publish({ type: "application.updated", applicationId: id });
    return { applicationId: id, answers: answers.length };
  } catch (e) {
    repos.applications.setAnswersStatus(id, "error", (e as Error).message);
    await deps.publish({ type: "application.updated", applicationId: id });
    throw e;
  }
};
