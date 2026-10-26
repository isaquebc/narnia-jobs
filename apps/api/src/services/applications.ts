import {
  APPLICATION_ANSWER_TASK,
  APPLICATION_TASKS,
  type ApplicationFormRecord,
  answerProfileId,
  declarationAnswer,
  PROFILE_MOTIVATIONS_TASK,
  prefillValue,
  type Repos,
} from "@narnia-jobs/core";
import type { ApplicationFormView } from "@narnia-jobs/shared";
import type { QueueAdapter } from "../queue";

/** Pede ao worker as perguntas do formulário (F12/M3); a chave muda a cada pedido (ler de novo). */
/** Pede as respostas sugeridas (F12/M4); só faz sentido com a vaga ligada (F12-11). */
export async function enqueueAnswers(
  repos: Repos,
  queue: QueueAdapter,
  applicationId: string,
  questionIds?: string[],
) {
  repos.applications.setAnswersStatus(applicationId, "answering");
  const { job } = await queue.enqueueTask({
    queue: "extract",
    type: APPLICATION_ANSWER_TASK,
    key: `${applicationId}-${Date.now()}`,
    // F12-23: suposição recusada refaz só a pergunta dela
    payload: questionIds ? { applicationId, questionIds } : { applicationId },
  });
  return job;
}

/** Motivações do perfil sugeridas pelo histórico (F12-23); `count` pede uma no lugar de uma recusada. */
export async function enqueueMotivations(queue: QueueAdapter, profileId: string, count?: number) {
  const { job } = await queue.enqueueTask({
    queue: "extract",
    type: PROFILE_MOTIVATIONS_TASK,
    key: `${profileId}-${Date.now()}`,
    payload: count ? { profileId, count } : { profileId },
  });
  return job;
}

/** Sugestão de motivações na fila ou rodando para o perfil (a janela mostra "sugerindo"). */
export function suggestingMotivations(repos: Repos, profileId: string): boolean {
  return (["queued", "active", "stalled"] as const).some((status) =>
    repos.jobs
      .list({ status })
      // o espelho guarda o pedido inteiro da tarefa: o payload dela fica em `payload.payload`
      .some(
        (j) =>
          j.type === PROFILE_MOTIVATIONS_TASK &&
          (j.payload.payload as { profileId?: string } | undefined)?.profileId === profileId,
      ),
  );
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
  const answersProfileId = answerProfileId(repos, f);
  // F12-23: suposição já decidida na janela (aceita ou recusada), pelo texto que o roleplay escreveu
  const decided = new Map(
    (answersProfileId ? repos.profileMotivations.list(answersProfileId) : [])
      .filter((m) => m.assumption && m.status !== "suggested")
      .map((m) => [m.assumption as string, m.status as "accepted" | "refused"]),
  );
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
      // F12-12: autodeclaração já dada no chat vira a opção da página, pelo código
      prefill: q.profileField
        ? prefillValue(repos, q.profileField)
        : q.kind === "self_declaration"
          ? declarationAnswer(repos, q)
          : null,
      answer: answers.get(q.id) ?? null,
      assumptionStatus: (answers.get(q.id)?.assumptions ?? []).map((a) => decided.get(a) ?? null),
    })),
    answersStatus: f.answersStatus,
    answersError: f.answersError,
    answersProfileId,
    chatSessionId: f.chatSessionId,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
