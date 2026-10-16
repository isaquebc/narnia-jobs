import type { Notification } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { DocumentRecord } from "../db/repos/documents";

/**
 * Avisos do CV e da carta (F05-13): "pronto" (informativo, some ao ser visto) ou "não passou na revisão" (alerta até
 * uma versão nova passar). Um aberto por documento; o link leva à aba do currículo no perfil ou à vaga.
 */
export function documentUrl(doc: Pick<DocumentRecord, "id" | "profileId" | "postingId">): string {
  return doc.postingId
    ? `/vagas/${doc.postingId}?doc=${doc.id}`
    : `/perfis/${doc.profileId}/curriculo`;
}

function documentLabel(repos: Repos, doc: DocumentRecord): string {
  const what = doc.kind === "cv" ? "Currículo" : "Carta";
  const posting = doc.postingId ? repos.postings.get(doc.postingId) : null;
  const profile = repos.profiles.get(doc.profileId);
  const target = posting
    ? (posting.client ?? posting.company ?? posting.title ?? "vaga")
    : (profile?.name ?? "perfil");
  return `${what} · ${target}`;
}

export function notifyDocumentResult(
  repos: Repos,
  doc: DocumentRecord,
  passed: boolean,
): { notification: Notification; created: boolean } {
  const label = documentLabel(repos, doc);
  repos.notifications.resolveSubject("document", doc.id, [
    passed ? "document.review_failed" : "document.ready",
  ]);
  const ev = repos.notifications.upsert({
    kind: passed ? "document.ready" : "document.review_failed",
    subjectKind: "document",
    subjectId: doc.id,
    title: passed ? `Pronto: ${label}` : `Não passou na revisão: ${label}`,
    actionUrl: documentUrl(doc),
    severity: passed ? "info" : "warning",
  });
  if (ev.created) return ev;
  return {
    notification: repos.notifications.markUnread(ev.notification.id) ?? ev.notification,
    created: false,
  };
}
