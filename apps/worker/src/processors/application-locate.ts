import {
  APPLICATION_ANSWER_TASK,
  answerableQuestions,
  assembleQuestions,
  type FormStep,
  heuristicQuestions,
  POSTING_MODEL_DEFAULTS,
  recordUsage,
  resolveModel,
  stepQuestions,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { TaskHandler } from "../tasks";

/**
 * Perguntas do formulário de candidatura (F12/M3, §4.6-1): a heurística resolve os campos óbvios, o consentimento e a
 * autodeclaração sem tokens; o Haiku organiza o resto, e o código confere a saída. Falha deixa o formulário em `error`
 * (a janela oferece ler de novo). Formulário em várias etapas (F12/M6): `step` organiza só a etapa nova; sem ele (Ler de
 * novo), todas.
 */
export const applicationLocate: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const id = String(data.payload.applicationId ?? "");
  const form = repos.applications.get(id);
  if (!form) return { skipped: "application_not_found" };
  const only = typeof data.payload.step === "number" ? data.payload.step : null;
  const steps = form.steps.filter((s) => only === null || s.n === only);
  try {
    await ctx.progress(20, "heuristic");
    const located = [];
    let usedModel = false;
    let warning: string | null = null;
    for (const step of steps) {
      const r = await locateStep(step, form, ctx, deps);
      usedModel ||= r.model;
      // o aviso de uma etapa não some quando a seguinte sai sem aviso
      warning = r.warning ?? warning;
      repos.applications.setStepQuestions(id, step.n, r.questions, warning);
      located.push(...r.questions);
    }
    // F12/M4: com a vaga ligada, as respostas sugeridas vêm em seguida (sem vaga, a janela pede para ligar, F12-11);
    // a etapa nova só pede as dela, sem refazer as respostas das outras
    const answerable = answerableQuestions(located);
    if (form.postingId && answerable.length) {
      repos.applications.setAnswersStatus(id, "answering");
      await deps.enqueueTask({
        queue: "extract",
        type: APPLICATION_ANSWER_TASK,
        key: `${id}-${Date.now()}`,
        payload:
          only === null
            ? { applicationId: id }
            : { applicationId: id, questionIds: answerable.map((q) => q.id) },
      });
    }
    await deps.publish({ type: "application.updated", applicationId: id });
    return { applicationId: id, questions: located.length, model: usedModel };
  } catch (e) {
    repos.applications.setError(id, (e as Error).message);
    await deps.publish({ type: "application.updated", applicationId: id });
    throw e;
  }
};

async function locateStep(
  step: FormStep,
  form: { url: string; title: string | null },
  ctx: Parameters<TaskHandler>[1],
  deps: Parameters<TaskHandler>[2],
) {
  const { repos } = deps;
  const h = heuristicQuestions(step.fields);
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
        page: { url: step.url, title: step.title ?? form.title },
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
  return {
    questions: stepQuestions(assembleQuestions(step.fields, h, model), step.n),
    warning,
    model: model !== null,
  };
}
