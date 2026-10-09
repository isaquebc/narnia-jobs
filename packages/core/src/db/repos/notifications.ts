import {
  type Notification,
  type NotificationKind,
  NotificationSchema,
  nowUtc,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { type Row, str } from "../sql";

/**
 * Notificações (F03-10): uma pendência aberta por (tipo, assunto). Quem resolve é o fluxo dono do assunto
 * (`resolveSubject`, ex.: revisão salva); ler marca `readAt`; dispensar só esconde da lista aberta, sem resolver.
 * Tasks futuras só chamam `upsert` com um tipo novo de `NOTIFICATION_KINDS`.
 */
export interface NotificationInput {
  kind: NotificationKind;
  subjectKind: string;
  subjectId: string;
  title: string;
  body?: string | null;
  actionUrl: string;
  severity?: Notification["severity"];
}

export interface NotificationsRepo {
  /** Cria ou atualiza a pendência aberta do mesmo (tipo, assunto); `created` distingue o evento WS. */
  upsert(input: NotificationInput): { notification: Notification; created: boolean };
  get(id: string): Notification | null;
  /** Resolve as pendências abertas do assunto (todas ou só dos tipos dados); devolve as resolvidas. */
  resolveSubject(
    subjectKind: string,
    subjectId: string,
    kinds?: NotificationKind[],
  ): Notification[];
  markRead(id: string): Notification | null;
  dismiss(id: string): Notification | null;
  /** `open` (padrão): não resolvidas e não dispensadas; `resolved`; `all`. Mais novas primeiro. */
  list(filter?: { status?: "open" | "resolved" | "all" }): Notification[];
  /** Contador do sino: abertas e não dispensadas. */
  countUnresolved(): number;
}

function map(r: Row): Notification {
  return NotificationSchema.parse({
    id: String(r.id),
    kind: String(r.kind),
    subjectKind: String(r.subject_kind),
    subjectId: String(r.subject_id),
    title: String(r.title),
    body: str(r.body),
    actionUrl: String(r.action_url),
    severity: String(r.severity),
    createdAt: String(r.created_at),
    readAt: str(r.read_at),
    dismissedAt: str(r.dismissed_at),
    resolvedAt: str(r.resolved_at),
  });
}

export function notificationsRepo(db: Db): NotificationsRepo {
  const findOpen = db.prepare(
    "select * from notification where kind = ? and subject_kind = ? and subject_id = ? and resolved_at is null",
  );
  const insert = db.prepare(
    `insert into notification (id, kind, subject_kind, subject_id, title, body, action_url, severity, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    "update notification set title = ?, body = ?, action_url = ?, severity = ? where id = ?",
  );
  const get = db.prepare("select * from notification where id = ?");
  const openBySubject = db.prepare(
    "select * from notification where subject_kind = ? and subject_id = ? and resolved_at is null",
  );
  const resolve = db.prepare("update notification set resolved_at = ? where id = ?");
  const read = db.prepare("update notification set read_at = coalesce(read_at, ?) where id = ?");
  const dismiss = db.prepare(
    "update notification set dismissed_at = coalesce(dismissed_at, ?) where id = ?",
  );
  const all = db.prepare("select * from notification order by created_at desc, rowid desc");
  const count = db.prepare(
    "select count(*) as n from notification where resolved_at is null and dismissed_at is null",
  );
  const repo: NotificationsRepo = {
    upsert(i) {
      const existing = findOpen.get(i.kind, i.subjectKind, i.subjectId) as Row | undefined;
      const severity = i.severity ?? "info";
      if (existing) {
        update.run(i.title, i.body ?? null, i.actionUrl, severity, String(existing.id));
        return { notification: repo.get(String(existing.id)) as Notification, created: false };
      }
      const id = newId();
      insert.run(
        id,
        i.kind,
        i.subjectKind,
        i.subjectId,
        i.title,
        i.body ?? null,
        i.actionUrl,
        severity,
        nowUtc(),
      );
      return { notification: repo.get(id) as Notification, created: true };
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    resolveSubject(subjectKind, subjectId, kinds) {
      const now = nowUtc();
      const open = (openBySubject.all(subjectKind, subjectId) as Row[])
        .map(map)
        .filter((n) => !kinds || kinds.includes(n.kind));
      for (const n of open) resolve.run(now, n.id);
      return open.map((n) => repo.get(n.id) as Notification);
    },
    markRead(id) {
      read.run(nowUtc(), id);
      return repo.get(id);
    },
    dismiss(id) {
      dismiss.run(nowUtc(), id);
      return repo.get(id);
    },
    list(filter = {}) {
      const status = filter.status ?? "open";
      return (all.all() as Row[]).map(map).filter((n) => {
        if (status === "all") return true;
        if (status === "resolved") return n.resolvedAt !== null;
        return n.resolvedAt === null && n.dismissedAt === null;
      });
    },
    countUnresolved() {
      return Number((count.get() as { n: number }).n);
    },
  };
  return repo;
}
