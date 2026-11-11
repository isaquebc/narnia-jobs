import type { Db } from "../open";

/** Remetente (endereço ou `@domínio`) com a escolha da pessoa e o histórico (F14-13). */
export interface MailSenderRecord {
  value: string;
  override: "trusted" | "blocked" | null;
  overrideOrigin: "manual" | "extension" | "review" | null;
  seenCount: number;
  okCount: number;
  rejectedCount: number;
  lastSeenAt: string | null;
}

export interface MailSendersRepo {
  get(value: string): MailSenderRecord | null;
  list(filter?: { override?: "trusted" | "blocked" }): MailSenderRecord[];
  setOverride(
    value: string,
    override: MailSenderRecord["override"],
    origin: MailSenderRecord["overrideOrigin"],
    at: string,
  ): MailSenderRecord;
  /** Conta um e-mail visto (e, quando já se sabe, se deu certo ou foi recusado na revisão). */
  bump(value: string, field: "seen" | "ok" | "rejected", at: string): void;
}

interface Row {
  value: string;
  override: MailSenderRecord["override"];
  override_origin: MailSenderRecord["overrideOrigin"];
  seen_count: number;
  ok_count: number;
  rejected_count: number;
  last_seen_at: string | null;
}

const map = (r: Row): MailSenderRecord => ({
  value: r.value,
  override: r.override,
  overrideOrigin: r.override_origin,
  seenCount: Number(r.seen_count),
  okCount: Number(r.ok_count),
  rejectedCount: Number(r.rejected_count),
  lastSeenAt: r.last_seen_at,
});

export function mailSendersRepo(db: Db): MailSendersRepo {
  const q = (sql: string) => db.prepare(sql);
  const ensure = (value: string, at: string) =>
    q(
      "insert into mail_sender (value, created_at, updated_at) values (?, ?, ?) on conflict (value) do nothing",
    ).run(value, at, at);
  const get = (value: string) => {
    const r = q("select * from mail_sender where value = ?").get(value) as unknown as
      | Row
      | undefined;
    return r ? map(r) : null;
  };
  return {
    get,
    list(filter = {}) {
      const rows = (filter.override
        ? q("select * from mail_sender where override = ? order by value").all(filter.override)
        : q("select * from mail_sender order by value").all()) as unknown as Row[];
      return rows.map(map);
    },
    setOverride(value, override, origin, at) {
      ensure(value, at);
      q(
        "update mail_sender set override = ?, override_origin = ?, updated_at = ? where value = ?",
      ).run(override, override ? origin : null, at, value);
      return get(value) as MailSenderRecord;
    },
    bump(value, field, at) {
      ensure(value, at);
      const col = field === "seen" ? "seen_count" : field === "ok" ? "ok_count" : "rejected_count";
      q(
        `update mail_sender set ${col} = ${col} + 1, updated_at = ?${field === "seen" ? ", last_seen_at = ?" : ""} where value = ?`,
      ).run(...(field === "seen" ? [at, at, value] : [at, value]));
    },
  };
}
