import {
  aliasBriefIds,
  answerableQuestions,
  assembleAnswers,
  assembleRoleplay,
  buildCvBrief,
  detectFormLocale,
  POSTING_MODEL_DEFAULTS,
  recordUsage,
  resolveModel,
  splitOpenQuestions,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { TaskHandler } from "../tasks";

/**
 * Respostas sugeridas do formulário (F12/M4, §4.6-3): com a vaga ligada (F12-11), o resumo do CV do perfil (o
 * recomendado pela análise da vaga, se houver) vai com os dados pessoais ao Sonnet; a conferência por código guarda
 * uma versão nova de cada resposta. Sem vaga, não responde (a janela pede para ligar uma).
 *
 * F12-18: as perguntas abertas (motivação, apresentação) vão ao roleplay, que escreve como a pessoa, com a empresa, a
 * descrição da vaga e os textos que ela já editou (a voz dela); as de fato ficam no redator. As duas chamadas correm
 * juntas e o que deu certo é guardado mesmo se a outra falhar. F12-19: resposta editada pela pessoa não é refeita.
 */
const VOICE_SAMPLES = 3;
const SAMPLE_CHARS = 800;
const DESCRIPTION_CHARS = 6000;

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
  const edited = new Set(
    repos.applications
      .latestAnswers(id)
      .filter((a) => a.source === "edited")
      .map((a) => a.questionId),
  );
  const questions = answerableQuestions(form.questions).filter((q) => !edited.has(q.id));
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
    const locale = detectFormLocale(answerableQuestions(form.questions));
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
    const toInput = (qs: typeof questions) =>
      qs.map((q) => ({
        questionId: q.id,
        question: q.question,
        kind: q.kind,
        options: q.options.map((o) => o.label),
        maxChars: q.maxChars,
        required: q.required,
      }));
    const { facts, open } = splitOpenQuestions(questions);
    const posting = repos.postings.get(form.postingId);
    const usage = (sdk: Parameters<typeof usageFromSdkResult>[0], category: string) =>
      recordUsage(
        repos,
        deps.dataDir,
        usageFromSdkResult(sdk, { category, model: m, jobId: ctx.jobId }),
      );
    const [factsRun, openRun] = await Promise.allSettled([
      facts.length
        ? deps.provider
            .applicationAnswer({
              brief: aliases.brief,
              person,
              locale,
              questions: toInput(facts),
              model: m,
            })
            .then((r) => {
              usage(r.sdk, "application.answer");
              return assembleAnswers(facts, r.output, aliases.resolve);
            })
        : Promise.resolve([]),
      open.length
        ? deps.provider
            .applicationRoleplay({
              brief: aliases.brief,
              person,
              company: {
                summary: posting?.companySummary ?? null,
                url: posting?.companyUrl ?? null,
                description: posting?.jdText?.slice(0, DESCRIPTION_CHARS) ?? null,
              },
              voice: repos.applications
                .editedTexts({ excludeFormId: id, limit: VOICE_SAMPLES })
                .map((t) => t.slice(0, SAMPLE_CHARS)),
              locale,
              questions: toInput(open),
              model: m,
            })
            .then((r) => {
              usage(r.sdk, "application.roleplay");
              return assembleRoleplay(open, r.output, aliases.resolve);
            })
        : Promise.resolve([]),
    ]);
    const answers = [factsRun, openRun].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (answers.length) repos.applications.addAnswers(id, answers);
    const failed = [factsRun, openRun].find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
    repos.applications.setAnswersStatus(id, "ready");
    await deps.publish({ type: "application.updated", applicationId: id });
    return { applicationId: id, answers: answers.length };
  } catch (e) {
    repos.applications.setAnswersStatus(id, "error", (e as Error).message);
    await deps.publish({ type: "application.updated", applicationId: id });
    throw e;
  }
};
