import {
  APPLICATION_TASKS,
  type ApplicationFormRecord,
  prefillValue,
  type Repos,
} from "@narnia-jobs/core";
import type { ApplicationFormView } from "@narnia-jobs/shared";
import type { QueueAdapter } from "../queue";

/** Pede ao worker as perguntas do formulário (F12/M3); a chave muda a cada pedido (ler de novo). */
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
  return {
    id: f.id,
    captureId: f.captureId,
    url: f.url,
    title: f.title,
    status: f.status,
    error: f.error,
    postingId: posting ? posting.id : null,
    posting: posting ? { title: posting.title, company: posting.company } : null,
    profileId: f.profileId,
    questions: f.questions.map((q) => ({
      ...q,
      prefill: q.profileField ? prefillValue(repos, q.profileField) : null,
    })),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
