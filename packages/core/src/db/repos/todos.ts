import type { Todo, TodoFilter, TodoKind, TodoSource, TodoStatus } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import type { Row } from "../sql";

/** Tarefas (F15 §2.1): kanban com posição por coluna e tags. */
export interface TodoRecord extends Todo {
  notifiedDueSoonAt: string | null;
  notifiedOverdueAt: string | null;
}

export interface TodoInsert {
  title: string;
  note: string | null;
  status: TodoStatus;
  dueAt: string | null;
  actionUrl: string | null;
  source: TodoSource;
  kind: TodoKind | null;
  tags: string[];
  applicationId: string | null;
  postingId: string | null;
  mailMessageId: string | null;
}

export type TodoUpdate = Partial<
  Pick<
    TodoInsert,
    "title" | "note" | "dueAt" | "actionUrl" | "tags" | "applicationId" | "postingId"
  >
>;

export interface TodosRepo {
  create(i: TodoInsert, at: string): TodoRecord;
  get(id: string): TodoRecord | null;
  /** Por coluna e posição; `now` decide o que é vencida. */
  list(f: TodoFilter, now: string): TodoRecord[];
  update(id: string, patch: TodoUpdate, at: string): TodoRecord | null;
  /** Põe na coluna, no índice (sem índice: no fim), e renumera a coluna. */
  move(id: string, status: TodoStatus, index: number | undefined, at: string): TodoRecord | null;
  remove(id: string): void;
  tags(): Array<{ tag: string; count: number }>;
  byMail(mailMessageId: string): TodoRecord[];
  /** Abertas com prazo até `until` (inclusive as vencidas). */
  dueBefore(until: string): TodoRecord[];
  markNotified(id: string, which: "due_soon" | "overdue", at: string): void;
}

/** Tag guardada em minúsculas, sem espaços nas pontas e sem repetição. */
export const normalizeTags = (tags: string[]): string[] => [
  ...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
];

const str = (v: unknown) => (v == null ? null : String(v));

export function todosRepo(db: Db): TodosRepo {
  const q = (sql: string) => db.prepare(sql);
  const tagsOf = (id: string) =>
    (q("select tag from todo_tag where todo_id = ? order by tag").all(id) as Row[]).map((r) =>
      String(r.tag),
    );
  const map = (r: Row): TodoRecord => ({
    id: String(r.id),
    title: String(r.title),
    note: str(r.note),
    status: String(r.status) as TodoStatus,
    position: Number(r.position),
    dueAt: str(r.due_at),
    actionUrl: str(r.action_url),
    source: String(r.source) as TodoSource,
    kind: str(r.kind) as TodoKind | null,
    tags: tagsOf(String(r.id)),
    applicationId: str(r.job_application_id),
    postingId: str(r.posting_id),
    mailMessageId: str(r.mail_message_id),
    doneAt: str(r.done_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    notifiedDueSoonAt: str(r.notified_due_soon_at),
    notifiedOverdueAt: str(r.notified_overdue_at),
  });
  const get = (id: string) => {
    const r = q("select * from todo where id = ?").get(id) as Row | undefined;
    return r ? map(r) : null;
  };
  const setTags = (id: string, tags: string[]) => {
    q("delete from todo_tag where todo_id = ?").run(id);
    for (const t of normalizeTags(tags))
      q("insert into todo_tag (todo_id, tag) values (?, ?)").run(id, t);
  };
  const ids = (status: TodoStatus, except?: string) =>
    (q("select id from todo where status = ? order by position, created_at").all(status) as Row[])
      .map((r) => String(r.id))
      .filter((x) => x !== except);
  const renumber = (order: string[]) => {
    order.forEach((x, i) => {
      q("update todo set position = ? where id = ?").run(i, x);
    });
  };
  const tx = <T>(fn: () => T): T => {
    db.exec("savepoint todo_tx");
    try {
      const out = fn();
      db.exec("release todo_tx");
      return out;
    } catch (e) {
      db.exec("rollback to todo_tx");
      db.exec("release todo_tx");
      throw e;
    }
  };
  return {
    create(i, at) {
      const id = newId();
      return tx(() => {
        // a nova entra no topo da coluna
        const first = q("select min(position) as p from todo where status = ?").get(i.status) as
          | Row
          | undefined;
        const position = first?.p == null ? 0 : Number(first.p) - 1;
        q(
          `insert into todo (id, title, note, status, position, due_at, action_url, source, kind, job_application_id,
             posting_id, mail_message_id, done_at, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          i.title,
          i.note,
          i.status,
          position,
          i.dueAt,
          i.actionUrl,
          i.source,
          i.kind,
          i.applicationId,
          i.postingId,
          i.mailMessageId,
          i.status === "done" ? at : null,
          at,
          at,
        );
        setTags(id, i.tags);
        return get(id) as TodoRecord;
      });
    },
    get,
    list(f, now) {
      const where: string[] = [];
      const args: string[] = [];
      if (f.source) {
        where.push("t.source = ?");
        args.push(f.source);
      }
      if (f.applicationId) {
        where.push("t.job_application_id = ?");
        args.push(f.applicationId);
      }
      if (f.tag) {
        where.push("exists (select 1 from todo_tag g where g.todo_id = t.id and g.tag = ?)");
        args.push(f.tag.trim().toLowerCase());
      }
      if (f.overdue) {
        where.push("t.status <> 'done' and t.due_at is not null and t.due_at < ?");
        args.push(now);
      }
      if (f.q?.trim()) {
        where.push(
          `(t.title like ? escape '\\' or t.note like ? escape '\\'
            or exists (select 1 from todo_tag g where g.todo_id = t.id and g.tag like ? escape '\\'))`,
        );
        const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        args.push(like, like, like.toLowerCase());
      }
      const rows = q(
        `select t.* from todo t ${where.length ? `where ${where.join(" and ")}` : ""}
         order by case t.status when 'todo' then 0 when 'doing' then 1 else 2 end, t.position, t.created_at`,
      ).all(...args) as Row[];
      return rows.map(map);
    },
    update(id, p, at) {
      const cur = get(id);
      if (!cur) return null;
      return tx(() => {
        q(
          `update todo set title = ?, note = ?, due_at = ?, action_url = ?, job_application_id = ?, posting_id = ?,
             notified_due_soon_at = ?, notified_overdue_at = ?, updated_at = ? where id = ?`,
        ).run(
          p.title ?? cur.title,
          p.note !== undefined ? p.note : cur.note,
          p.dueAt !== undefined ? p.dueAt : cur.dueAt,
          p.actionUrl !== undefined ? p.actionUrl : cur.actionUrl,
          p.applicationId !== undefined ? p.applicationId : cur.applicationId,
          p.postingId !== undefined ? p.postingId : cur.postingId,
          // prazo novo: os avisos valem de novo
          p.dueAt !== undefined && p.dueAt !== cur.dueAt ? null : cur.notifiedDueSoonAt,
          p.dueAt !== undefined && p.dueAt !== cur.dueAt ? null : cur.notifiedOverdueAt,
          at,
          id,
        );
        if (p.tags) setTags(id, p.tags);
        return get(id);
      });
    },
    move(id, status, index, at) {
      const cur = get(id);
      if (!cur) return null;
      return tx(() => {
        const order = ids(status, id);
        const at_ = index === undefined ? order.length : Math.min(index, order.length);
        order.splice(at_, 0, id);
        q("update todo set status = ?, done_at = ?, updated_at = ? where id = ?").run(
          status,
          status === "done" ? (cur.doneAt ?? at) : null,
          at,
          id,
        );
        renumber(order);
        if (cur.status !== status) renumber(ids(cur.status));
        return get(id);
      });
    },
    remove(id) {
      q("delete from todo where id = ?").run(id);
    },
    tags() {
      return (
        q(
          "select tag, count(*) as n from todo_tag group by tag order by n desc, tag",
        ).all() as Row[]
      ).map((r) => ({ tag: String(r.tag), count: Number(r.n) }));
    },
    byMail(mailMessageId) {
      return (
        q("select * from todo where mail_message_id = ? order by created_at").all(
          mailMessageId,
        ) as Row[]
      ).map(map);
    },
    dueBefore(until) {
      return (
        q(
          "select * from todo where status <> 'done' and due_at is not null and due_at <= ? order by due_at",
        ).all(until) as Row[]
      ).map(map);
    },
    markNotified(id, which, at) {
      q(
        `update todo set ${which === "due_soon" ? "notified_due_soon_at" : "notified_overdue_at"} = ? where id = ?`,
      ).run(at, id);
    },
  };
}
