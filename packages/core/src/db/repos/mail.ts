import { newId } from "../../ids";
import type { Db } from "../open";

/** E-mail lido do Gmail (F14/M2). O conteúdo fica no `.eml`; aqui ficam o cabeçalho, o estado e o resultado. */
export type MailStatus =
  | "pending"
  | "processing"
  | "done"
  | "review"
  | "quarantine"
  | "ignored"
  | "error";

/**
 * O que um e-mail fez no domínio, para o desfazer (F14/M6): ids criados e o estado anterior do que mudou.
 */
export interface MailUndo {
  createdApplicationId?: string;
  createdPostingId?: string;
  entryIds?: string[];
  /** Negativa: o estado da candidatura antes de encerrar. */
  closed?: {
    applicationId: string;
    column: string;
    closedReason: string | null;
    closedStage: string | null;
    closedEntryId: string | null;
  };
  /** Etapa movida: a de antes. */
  stage?: { applicationId: string; fromStageId: string | null; toStageId: string | null };
  suggestionIds?: string[];
  eventIds?: string[];
  /** Eventos que já existiam e mudaram (remarcação, cancelamento, oficial no lugar da provisória). */
  eventPrev?: Array<{
    id: string;
    title: string;
    startsAt: string;
    durationMin: number;
    timezone: string;
    location: string | null;
    link: string | null;
    provisional: boolean;
    icsUid: string | null;
    cancelledAt: string | null;
    mailMessageId: string | null;
    remoteSequence: number | null;
    /** Como o e-mail deixou: o desfazer só reverte se o evento ainda estiver assim. */
    afterStartsAt: string;
    afterCancelledAt: string | null;
  }>;
}

export interface MailMessageRecord {
  id: string;
  gmailId: string;
  threadId: string | null;
  fromAddr: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string | null;
  receivedAt: string;
  size: number;
  labels: string[];
  rawPath: string;
  status: MailStatus;
  class: string | null;
  confidence: number | null;
  riskLevel: "trusted" | "neutral" | "high" | null;
  riskReasons: string[];
  result: Record<string, unknown> | null;
  error: string | null;
  gmailSynced: boolean;
  /** A etiqueta `narnia-jobs/suspeito` está no Gmail. */
  suspectLabel: boolean;
  processedAt: string | null;
  /** F14/M6: o que o e-mail fez (para desfazer) e quando foi desfeito. */
  undo: MailUndo | null;
  undoneAt: string | null;
  createdAt: string;
}

export type NewMailMessage = Pick<
  MailMessageRecord,
  | "gmailId"
  | "threadId"
  | "fromAddr"
  | "fromName"
  | "replyTo"
  | "subject"
  | "receivedAt"
  | "size"
  | "labels"
  | "rawPath"
>;

export interface MailRepo {
  /** Insere se o `gmail_id` ainda não existe; devolve o registro (novo ou o que já estava). */
  insert(m: NewMailMessage, at: string): { record: MailMessageRecord; created: boolean };
  get(id: string): MailMessageRecord | null;
  byGmailId(gmailId: string): MailMessageRecord | null;
  /** Dos ids do Gmail informados, os que já estão no banco. */
  known(gmailIds: string[]): Set<string>;
  /** Pendentes do mais antigo para o mais novo (a negativa nunca antes da candidatura, §2.2). */
  pending(limit: number): MailMessageRecord[];
  counts(): Record<MailStatus, number>;
  setStatus(id: string, status: MailStatus, at: string, extra?: { error?: string | null }): void;
  /** Ainda sem risco e pré-filtro (M3), do mais antigo para o mais novo. */
  unassessed(limit: number): MailMessageRecord[];
  setAssessment(
    id: string,
    a: {
      status: MailStatus;
      class: string;
      riskLevel: "trusted" | "neutral" | "high";
      riskReasons: string[];
      error?: string | null;
    },
    at: string,
  ): void;
  /** Em quarentena e ainda sem a etiqueta `narnia-jobs/suspeito` no Gmail. */
  quarantineToSync(limit: number): MailMessageRecord[];
  /** Com a etiqueta de suspeito no Gmail, mas fora da quarentena (reprocessado): a etiqueta sai; ignorado na quarentena a mantém. */
  suspectToRemove(limit: number): MailMessageRecord[];
  setSuspectLabel(ids: string[], on: boolean, at: string): void;
  setGmailSynced(ids: string[], synced: boolean, at: string): void;
  /** Mensagens deste remetente (endereço) ou domínio (`@dominio`) num estado. */
  bySender(value: string, status: MailStatus): MailMessageRecord[];
  /** Volta para o começo do processamento (avaliar de novo). */
  reset(id: string, at: string): void;
  /** Desfazer e refazer a leitura: volta ao começo do processamento (risco, classe, resultado e desfazer zerados). */
  resetForRedo(id: string, at: string): void;
  /** Revisão: guarda o que a pessoa decidiu (vaga escolhida) e devolve o e-mail à fila da classe dele. */
  setPendingWith(id: string, result: Record<string, unknown>, at: string): void;
  /** Avaliados e à espera do modelo ou do leitor por código (M4), do mais antigo para o mais novo. */
  toDigest(limit: number): MailMessageRecord[];
  setResult(
    id: string,
    r: {
      status: MailStatus;
      class: string;
      confidence: number | null;
      result: Record<string, unknown> | null;
    },
    at: string,
  ): void;
  /** Processados (`done`) que ainda não ganharam `narnia-jobs` e lido no Gmail. */
  digestToSync(limit: number): MailMessageRecord[];
  /** Por classe e estado (M5 e M6 pegam as candidaturas, negativas, atualizações e convites). */
  byClass(cls: string, status: MailStatus, limit: number): MailMessageRecord[];
  /** Várias classes juntas, do mais antigo para o mais novo (a ordem entre elas importa: §2.2). */
  byClasses(classes: string[], status: MailStatus, limit: number): MailMessageRecord[];
  /** Caixa de revisão e quarentena (F14-11, F14-14): os mais novos primeiro. */
  listByStatus(statuses: MailStatus[], limit: number): MailMessageRecord[];
  /** F14/M6: guarda o que o e-mail fez (soma ao que já havia). */
  addUndo(id: string, undo: MailUndo): void;
  /** F14/M6: desfeito; sai do processamento (`ignored`), com a data. */
  markUndone(id: string, at: string): void;
  /** E-mails que agiram sobre uma candidatura (resultado com o `applicationId`), do mais novo para o mais antigo. */
  forApplication(applicationId: string): MailMessageRecord[];
}

interface Row {
  id: string;
  gmail_id: string;
  thread_id: string | null;
  from_addr: string | null;
  from_name: string | null;
  reply_to: string | null;
  subject: string | null;
  received_at: string;
  size: number;
  labels_json: string;
  raw_path: string;
  status: MailStatus;
  class: string | null;
  confidence: number | null;
  risk_level: MailMessageRecord["riskLevel"];
  risk_reasons_json: string;
  result_json: string | null;
  error: string | null;
  gmail_synced: number;
  suspect_label: number;
  processed_at: string | null;
  undo_json: string | null;
  undone_at: string | null;
  created_at: string;
}

const map = (r: Row): MailMessageRecord => ({
  id: r.id,
  gmailId: r.gmail_id,
  threadId: r.thread_id,
  fromAddr: r.from_addr,
  fromName: r.from_name,
  replyTo: r.reply_to,
  subject: r.subject,
  receivedAt: r.received_at,
  size: Number(r.size),
  labels: JSON.parse(r.labels_json) as string[],
  rawPath: r.raw_path,
  status: r.status,
  class: r.class,
  confidence: r.confidence,
  riskLevel: r.risk_level,
  riskReasons: JSON.parse(r.risk_reasons_json) as string[],
  result: r.result_json ? (JSON.parse(r.result_json) as Record<string, unknown>) : null,
  error: r.error,
  gmailSynced: r.gmail_synced === 1,
  suspectLabel: r.suspect_label === 1,
  processedAt: r.processed_at,
  undo: r.undo_json ? (JSON.parse(r.undo_json) as MailUndo) : null,
  undoneAt: r.undone_at ?? null,
  createdAt: r.created_at,
});

const STATUSES: MailStatus[] = [
  "pending",
  "processing",
  "done",
  "review",
  "quarantine",
  "ignored",
  "error",
];

export function mailRepo(db: Db): MailRepo {
  const q = (sql: string) => db.prepare(sql);
  const get = (id: string) => {
    const r = q("select * from mail_message where id = ?").get(id) as unknown as Row | undefined;
    return r ? map(r) : null;
  };
  const byGmailId = (gmailId: string) => {
    const r = q("select * from mail_message where gmail_id = ?").get(gmailId) as unknown as
      | Row
      | undefined;
    return r ? map(r) : null;
  };
  return {
    insert(m, at) {
      const existing = byGmailId(m.gmailId);
      if (existing) return { record: existing, created: false };
      const id = newId();
      q(
        `insert into mail_message (id, gmail_id, thread_id, from_addr, from_name, reply_to, subject, received_at, size,
           labels_json, raw_path, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        m.gmailId,
        m.threadId,
        m.fromAddr,
        m.fromName,
        m.replyTo,
        m.subject,
        m.receivedAt,
        m.size,
        JSON.stringify(m.labels),
        m.rawPath,
        at,
        at,
      );
      return { record: get(id) as MailMessageRecord, created: true };
    },
    get,
    byGmailId,
    known(gmailIds) {
      const out = new Set<string>();
      for (let i = 0; i < gmailIds.length; i += 500) {
        const chunk = gmailIds.slice(i, i + 500);
        if (!chunk.length) continue;
        const rows = q(
          `select gmail_id from mail_message where gmail_id in (${chunk.map(() => "?").join(",")})`,
        ).all(...chunk) as Array<{ gmail_id: string }>;
        for (const r of rows) out.add(r.gmail_id);
      }
      return out;
    },
    pending(limit) {
      return (
        q(
          "select * from mail_message where status = 'pending' order by received_at, rowid limit ?",
        ).all(limit) as unknown as Row[]
      ).map(map);
    },
    counts() {
      const out = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<MailStatus, number>;
      for (const r of q(
        "select status, count(*) as n from mail_message group by status",
      ).all() as Array<{
        status: MailStatus;
        n: number;
      }>)
        out[r.status] = Number(r.n);
      return out;
    },
    unassessed(limit) {
      return (
        q(
          "select * from mail_message where status = 'pending' and class is null order by received_at, rowid limit ?",
        ).all(limit) as unknown as Row[]
      ).map(map);
    },
    setAssessment(id, a, at) {
      q(
        `update mail_message set status = ?, class = ?, risk_level = ?, risk_reasons_json = ?, error = ?, updated_at = ?
         where id = ?`,
      ).run(a.status, a.class, a.riskLevel, JSON.stringify(a.riskReasons), a.error ?? null, at, id);
    },
    quarantineToSync(limit) {
      return (
        q(
          "select * from mail_message where status = 'quarantine' and suspect_label = 0 order by received_at limit ?",
        ).all(limit) as unknown as Row[]
      ).map(map);
    },
    suspectToRemove(limit) {
      return (
        q(
          "select * from mail_message where status not in ('quarantine', 'ignored') and suspect_label = 1 order by received_at limit ?",
        ).all(limit) as unknown as Row[]
      ).map(map);
    },
    setSuspectLabel(ids, on, at) {
      for (const id of ids)
        q("update mail_message set suspect_label = ?, updated_at = ? where id = ?").run(
          on ? 1 : 0,
          at,
          id,
        );
    },
    setGmailSynced(ids, synced, at) {
      for (const id of ids)
        q("update mail_message set gmail_synced = ?, updated_at = ? where id = ?").run(
          synced ? 1 : 0,
          at,
          id,
        );
    },
    bySender(value, status) {
      const rows = (value.startsWith("@")
        ? q(
            "select * from mail_message where status = ? and (from_addr like ? or from_addr like ?) order by received_at",
          ).all(status, `%${value}`, `%.${value.slice(1)}`)
        : q(
            "select * from mail_message where status = ? and from_addr = ? order by received_at",
          ).all(status, value)) as unknown as Row[];
      return rows.map(map);
    },
    toDigest(limit) {
      return (
        q(
          `select * from mail_message where status = 'pending' and class in ('candidate', 'unknown')
           order by received_at, rowid limit ?`,
        ).all(limit) as unknown as Row[]
      ).map(map);
    },
    setResult(id, r, at) {
      q(
        `update mail_message set status = ?, class = ?, confidence = ?, result_json = ?, processed_at = ?, updated_at = ?
         where id = ?`,
      ).run(
        r.status,
        r.class,
        r.confidence,
        r.result ? JSON.stringify(r.result) : null,
        at,
        at,
        id,
      );
    },
    digestToSync(limit) {
      return (
        q(
          "select * from mail_message where status = 'done' and gmail_synced = 0 order by received_at limit ?",
        ).all(limit) as unknown as Row[]
      ).map(map);
    },
    byClass(cls, status, limit) {
      return (
        q(
          "select * from mail_message where class = ? and status = ? order by received_at, rowid limit ?",
        ).all(cls, status, limit) as unknown as Row[]
      ).map(map);
    },
    byClasses(classes, status, limit) {
      if (!classes.length) return [];
      return (
        q(
          `select * from mail_message where status = ? and class in (${classes.map(() => "?").join(",")})
           order by received_at, rowid limit ?`,
        ).all(status, ...classes, limit) as unknown as Row[]
      ).map(map);
    },
    listByStatus(statuses, limit) {
      if (!statuses.length) return [];
      return (
        q(
          `select * from mail_message where status in (${statuses.map(() => "?").join(",")})
           order by received_at desc, rowid desc limit ?`,
        ).all(...statuses, limit) as unknown as Row[]
      ).map(map);
    },
    addUndo(id, undo) {
      const cur = get(id)?.undo ?? {};
      const merged: MailUndo = { ...cur };
      for (const [k, v] of Object.entries(undo) as Array<[keyof MailUndo, unknown]>) {
        const prev = cur[k];
        (merged as Record<string, unknown>)[k] =
          Array.isArray(prev) && Array.isArray(v) ? [...prev, ...v] : v;
      }
      q("update mail_message set undo_json = ? where id = ?").run(JSON.stringify(merged), id);
    },
    markUndone(id, at) {
      q(
        "update mail_message set status = 'ignored', undone_at = ?, updated_at = ? where id = ?",
      ).run(at, at, id);
    },
    forApplication(applicationId) {
      return (
        q(
          `select * from mail_message where json_extract(result_json, '$.applicationId') = ?
             order by received_at desc`,
        ).all(applicationId) as unknown as Row[]
      ).map(map);
    },
    setPendingWith(id, result, at) {
      q(
        "update mail_message set status = 'pending', result_json = ?, error = null, updated_at = ? where id = ?",
      ).run(JSON.stringify(result), at, id);
    },
    resetForRedo(id, at) {
      q(
        `update mail_message set status = 'pending', class = null, confidence = null, risk_level = null,
           risk_reasons_json = '[]', result_json = null, error = null, undo_json = null, undone_at = null,
           processed_at = null, gmail_synced = 0, updated_at = ? where id = ?`,
      ).run(at, id);
    },
    reset(id, at) {
      q(
        `update mail_message set status = 'pending', class = null, risk_level = null, risk_reasons_json = '[]',
           error = null, updated_at = ? where id = ?`,
      ).run(at, id);
    },
    setStatus(id, status, at, extra = {}) {
      q("update mail_message set status = ?, error = ?, updated_at = ? where id = ?").run(
        status,
        extra.error ?? null,
        at,
        id,
      );
    },
  };
}
