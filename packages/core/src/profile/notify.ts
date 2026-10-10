import type { Notification } from "@narnia-jobs/shared";
import type { Repos } from "../db";

/**
 * Notificações da F02 ligadas pela F03 (F03-10): sugestões de perfil e análise de perfis concluída. Mesmo contrato
 * de `syncRunNotifications`: idempotente (upsert por tipo + assunto), resolução automática quando a pendência some,
 * e devolve os eventos para a api/worker retransmitirem por WS.
 */
export const SUGGESTION_SUBJECT = "profile_suggestion";
export const ANALYSIS_SUBJECT = "job";
const PROFILES_URL = "/perfis";

export interface ProfileNotificationEvent {
  notification: Notification;
  created: boolean;
}

/** Uma notificação por sugestão `new`; resolve as de sugestões já aceitas, dispensadas ou apagadas. */
export function syncSuggestionNotifications(repos: Repos): ProfileNotificationEvent[] {
  const events: ProfileNotificationEvent[] = [];
  const fresh = repos.suggestions.list({ status: "new" });
  const freshIds = new Set(fresh.map((s) => s.id));
  for (const s of fresh) {
    const ev = repos.notifications.upsert({
      kind: "profile.suggestion",
      subjectKind: SUGGESTION_SUBJECT,
      subjectId: s.id,
      title: `Sugestão de perfil: ${s.payload.title}`,
      body: s.payload.rationale || null,
      actionUrl: PROFILES_URL,
      severity: "info",
    });
    if (ev.created) events.push(ev);
  }
  const stale = repos.notifications
    .list({ status: "open" })
    .filter((n) => n.kind === "profile.suggestion" && !freshIds.has(n.subjectId));
  for (const n of stale) {
    for (const r of repos.notifications.resolveSubject(SUGGESTION_SUBJECT, n.subjectId, [
      "profile.suggestion",
    ])) {
      events.push({ notification: r, created: false });
    }
  }
  return events;
}

/** "Análise de perfis concluída" por job (dedupe pelo id do job). */
export function notifyAnalysisDone(
  repos: Repos,
  jobId: string,
  result: { created: number; skipped: number },
): ProfileNotificationEvent {
  const n = result.created;
  return repos.notifications.upsert({
    kind: "profile.analysis_done",
    subjectKind: ANALYSIS_SUBJECT,
    subjectId: jobId,
    title: "Análise de perfis concluída",
    body:
      n === 0
        ? "Nenhuma sugestão nova"
        : `${n} ${n === 1 ? "sugestão nova" : "sugestões novas"} para avaliar`,
    actionUrl: PROFILES_URL,
    severity: "info",
  });
}

/** Resolve as análises concluídas em aberto (página de perfis aberta ou sugestões decididas). */
export function resolveAnalysisDone(repos: Repos): Notification[] {
  const out: Notification[] = [];
  for (const n of repos.notifications
    .list({ status: "open" })
    .filter((x) => x.kind === "profile.analysis_done")) {
    out.push(
      ...repos.notifications.resolveSubject(ANALYSIS_SUBJECT, n.subjectId, [
        "profile.analysis_done",
      ]),
    );
  }
  return out;
}
