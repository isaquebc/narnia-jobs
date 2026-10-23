import {
  APPLICATION_ANSWER_TASK,
  answerableQuestions,
  assembleQuestions,
  heuristicQuestions,
  POSTING_MODEL_DEFAULTS,
  recordUsage,
  resolveModel,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { TaskHandler } from "../tasks";

/**
 * Perguntas do formulário de candidatura (F12/M3, §4.6-1): a heurística resolve os campos óbvios, o consentimento e a
 * autodeclaração sem tokens; o Haiku organiza o resto, e o código confere a saída. Falha deixa o formulário em `error`
 * (a janela oferece ler de novo).
 */
export const applicationLocate: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const id = String(data.payload.applicationId ?? "");
  const form = repos.applications.get(id);
  if (!form) return { skipped: "application_not_found" };
  try {
    await ctx.progress(20, "heuristic");
    const h = heuristicQuestions(form.fields);
    let model = null;
    let warning: string | null = null;
    if (h.rest.length > 0) {
      await ctx.progress(40, "locating");
      try {
        const m = resolveModel(
          repos.settings,
          "application_locate",
          POSTING_MODEL_DEFAULTS.application_locate,
        );
        const r = await deps.provider.applicationLocate({
          page: { url: form.url, title: form.title },
          fields: h.rest,
          model: m,
        });
        recordUsage(
          repos,
          deps.dataDir,
          usageFromSdkResult(r.sdk, { category: "application.locate", model: m, jobId: ctx.jobId }),
        );
        model = r.output;
      } catch (e) {
        // o modelo não respondeu: as perguntas saem pelos rótulos e o motivo fica como aviso na janela
        warning = (e as Error).message;
      }
    }
    const questions = assembleQuestions(form.fields, h, model);
    repos.applications.setQuestions(id, questions, warning);
    // F12/M4: com a vaga ligada, as respostas sugeridas vêm em seguida (sem vaga, a janela pede para ligar, F12-11)
    if (form.postingId && answerableQuestions(questions).length) {
      repos.applications.setAnswersStatus(id, "answering");
      await deps.enqueueTask({
        queue: "extract",
        type: APPLICATION_ANSWER_TASK,
        key: `${id}-${Date.now()}`,
        payload: { applicationId: id },
      });
    }
    await deps.publish({ type: "application.updated", applicationId: id });
    return { applicationId: id, questions: questions.length, model: model !== null };
  } catch (e) {
    repos.applications.setError(id, (e as Error).message);
    await deps.publish({ type: "application.updated", applicationId: id });
    throw e;
  }
};
