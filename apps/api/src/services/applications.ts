import {
  APPLICATION_ANSWER_TASK,
  APPLICATION_TASKS,
  type ApplicationFormRecord,
  prefillValue,
  type Repos,
} from "@narnia-jobs/core";
import type { ApplicationFormView } from "@narnia-jobs/shared";
import type { QueueAdapter } from "../queue";

/** Pede ao worker as perguntas do formulário (F12/M3); a chave muda a cada pedido (ler de novo). */
/** Pede as respostas sugeridas (F12/M4); só faz sentido com a vaga ligada (F12-11). */
export async function enqueueAnswers(repos: Repos, queue: QueueAdapter, applicationId: string) {
  repos.applications.setAnswersStatus(applicationId, "answering");
  const { job } = await queue.enqueueTask({
    queue: "extract",
    type: APPLICATION_ANSWER_TASK,
    key: `${applicationId}-${Date.now()}`,
    payload: { applicationId },
  });
  return job;
}

export async function enqueueLocate(queue: QueueAdapter, applicationId: string) {
  const { job } = await queue.enqueueTask({
    queue: "extract",
    type: APPLICATION_TASKS.locate,
    key: `${applicationId}-${Date.now()}`,
    payload: { applicationId },
  });
  return job;
}

/** O formulário para a janela: o valor dos campos óbvios sai dos dados da pessoa na hora (sempre o atual). */
export function applicationView(repos: Repos, f: ApplicationFormRecord): ApplicationFormView {
  const posting = f.postingId ? repos.postings.get(f.postingId) : null;
  const answers = new Map(repos.applications.latestAnswers(f.id).map((a) => [a.questionId, a]));
  return {
    id: f.id,
    captureId: f.captureId,
    url: f.url,
    title: f.title,
    status: f.status,
    error: f.status === "error" ? f.error : null,
    warning: f.status === "ready" ? f.error : null,
    postingId: posting ? posting.id : null,
    posting: posting ? { title: posting.title, company: posting.company } : null,
    profileId: f.profileId,
    questions: f.questions.map((q) => ({
      ...q,
      prefill: q.profileField ? prefillValue(repos, q.profileField) : null,
      answer: answers.get(q.id) ?? null,
    })),
    answersStatus: f.answersStatus,
    answersError: f.answersError,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
