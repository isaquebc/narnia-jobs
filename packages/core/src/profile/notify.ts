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

/** Assunto da notificação agrupada de sugestões (CM-3): uma só para todas as sugestões novas. */
export const SUGGESTIONS_GROUP_ID = "all";

/**
 * Sugestões de perfil numa notificação única (CM-3): "Sugestão de perfil: X" com uma, "N sugestões de perfil" com
 * várias; diminui conforme o dono decide e resolve em zero. Sugestão nova volta a acender o sino (não vista).
 * Notificações antigas, uma por sugestão, são resolvidas (fundidas na agrupada) sem migration.
 */
export function syncSuggestionNotifications(repos: Repos): ProfileNotificationEvent[] {
  const events: ProfileNotificationEvent[] = [];
  const fresh = repos.suggestions.list({ status: "new" });
  const openNow = repos.notifications
    .list({ status: "open" })
    .filter((n) => n.kind === "profile.suggestion");
  for (const legacy of openNow.filter((n) => n.subjectId !== SUGGESTIONS_GROUP_ID)) {
    for (const r of repos.notifications.resolveSubject(SUGGESTION_SUBJECT, legacy.subjectId, [
      "profile.suggestion",
    ]))
      events.push({ notification: r, created: false });
  }
  const group = openNow.find((n) => n.subjectId === SUGGESTIONS_GROUP_ID) ?? null;
  if (fresh.length === 0) {
    if (group) {
      for (const r of repos.notifications.resolveSubject(SUGGESTION_SUBJECT, SUGGESTIONS_GROUP_ID, [
        "profile.suggestion",
      ]))
        events.push({ notification: r, created: false });
    }
    return events;
  }
  const previous = group ? Number(/^(\d+) /.exec(group.title)?.[1] ?? 1) : 0;
  const title =
    fresh.length === 1
      ? `Sugestão de perfil: ${fresh[0]?.payload.title ?? ""}`
      : `${fresh.length} sugestões de perfil`;
  const ev = repos.notifications.upsert({
    kind: "profile.suggestion",
    subjectKind: SUGGESTION_SUBJECT,
    subjectId: SUGGESTIONS_GROUP_ID,
    title,
    body: fresh.map((s) => s.payload.title).join("; "),
    actionUrl: PROFILES_URL,
    severity: "info",
  });
  let notification = ev.notification;
  if (!ev.created && fresh.length > previous) {
    notification = repos.notifications.markUnread(notification.id) ?? notification;
  }
  if (ev.created || fresh.length !== previous) events.push({ notification, created: ev.created });
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
