import type { Repos } from "../db";
import type { SnapshotRecord } from "../db/repos/snapshots";
import type { NotificationEvent } from "./notify";

/**
 * Teto dos snapshots (F03-9, correções F03 item 15): acima de `snapshots.max_bytes` uma notificação avisa e aponta
 * Configurações; voltando para baixo do teto, ela se resolve sozinha. A poda escolhe os menos usados (LRU).
 */
export const SNAPSHOTS_SUBJECT = "snapshots";
export const SNAPSHOTS_SUBJECT_ID = "github";

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

export function syncSnapshotCapNotification(repos: Repos, maxBytes: number): NotificationEvent[] {
  const total = repos.snapshots.totalBytes();
  if (maxBytes > 0 && total > maxBytes) {
    return [
      repos.notifications.upsert({
        kind: "snapshots.over_cap",
        subjectKind: SNAPSHOTS_SUBJECT,
        subjectId: SNAPSHOTS_SUBJECT_ID,
        title: "Snapshots acima do teto",
        body: `${mb(total)} MB em uso, teto de ${mb(maxBytes)} MB. Apague os mais antigos em Configurações.`,
        actionUrl: "/configuracoes",
        severity: "warning",
      }),
    ];
  }
  return repos.notifications
    .resolveSubject(SNAPSHOTS_SUBJECT, SNAPSHOTS_SUBJECT_ID, ["snapshots.over_cap"])
    .map((notification) => ({ notification, created: false }));
}

/** Os menos usados primeiro, até o total caber no teto. */
export function planSnapshotPrune(repos: Repos, maxBytes: number): SnapshotRecord[] {
  let total = repos.snapshots.totalBytes();
  const out: SnapshotRecord[] = [];
  for (const s of repos.snapshots.lru()) {
    if (total <= maxBytes) break;
    out.push(s);
    total -= s.size;
  }
  return out;
}
