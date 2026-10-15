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
  /** Volta a "não vista" (ex.: a agrupada de sugestões ganhou uma sugestão nova, CM-3). */
  markUnread(id: string): Notification | null;
  dismiss(id: string): Notification | null;
  /** `open` (padrão): não resolvidas e não dispensadas; `resolved`; `all`. Mais novas primeiro. */
  list(filter?: { status?: "open" | "resolved" | "all" }): Notification[];
  /** Contador do sino: abertas e não dispensadas, sem as informativas (`INFORMATIONAL_KINDS`, FX-3). */
  countUnresolved(): number;
  /** Contador do sino (CM-3): como `countUnresolved`, mas só as que o dono ainda não viu (`read_at` nulo). */
  countUnseen(): number;
  /** Resolve as informativas abertas criadas antes de `now - INFORMATIONAL_TTL_DAYS` (FX-3); devolve as resolvidas. */
  expireInformational(now?: Date): Notification[];
}

/** Tipos informativos (FX-3): não contam no sino e se resolvem ao abrir o assunto ou após `INFORMATIONAL_TTL_DAYS`. */
export const INFORMATIONAL_KINDS: readonly NotificationKind[] = [
  "ingestion.done",
  "posting.analysis_done",
];
export const INFORMATIONAL_TTL_DAYS = 7;

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
  // atômico no banco: api e worker (processos diferentes) podem criar a mesma pendência ao mesmo tempo; "procura e
  // insere" derrubava o worker com UNIQUE (e2e de 2026-10-12). Conflito na aberta = atualiza a existente
  const insert = db.prepare(
    `insert into notification (id, kind, subject_kind, subject_id, title, body, action_url, severity, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (kind, subject_kind, subject_id) where resolved_at is null do update set
       title = excluded.title, body = excluded.body, action_url = excluded.action_url, severity = excluded.severity`,
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
  const unread = db.prepare("update notification set read_at = null where id = ?");
  const dismiss = db.prepare(
    "update notification set dismissed_at = coalesce(dismissed_at, ?) where id = ?",
  );
  const all = db.prepare("select * from notification order by created_at desc, rowid desc");
  const informational = INFORMATIONAL_KINDS.map((k) => `'${k}'`).join(", ");
  const count = db.prepare(
    `select count(*) as n from notification where resolved_at is null and dismissed_at is null and kind not in (${informational})`,
  );
  const countUnseenStmt = db.prepare(
    `select count(*) as n from notification where resolved_at is null and dismissed_at is null and read_at is null and kind not in (${informational})`,
  );
  const staleInformational = db.prepare(
    `select * from notification where resolved_at is null and kind in (${informational}) and created_at < ?`,
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
      const row = findOpen.get(i.kind, i.subjectKind, i.subjectId) as Row | undefined;
      const saved = row ? String(row.id) : id;
      return { notification: repo.get(saved) as Notification, created: saved === id };
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
    expireInformational(now = new Date()) {
      const cutoff = new Date(now.getTime() - INFORMATIONAL_TTL_DAYS * 86_400_000).toISOString();
      const stale = (staleInformational.all(cutoff) as Row[]).map(map);
      const at = nowUtc();
      for (const n of stale) resolve.run(at, n.id);
      return stale.map((n) => repo.get(n.id) as Notification);
    },
    markRead(id) {
      read.run(nowUtc(), id);
      return repo.get(id);
    },
    markUnread(id) {
      unread.run(id);
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
    countUnseen() {
      return Number((countUnseenStmt.get() as { n: number }).n);
    },
  };
  return repo;
}
