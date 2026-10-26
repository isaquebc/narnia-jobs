import type { MotivationSource, MotivationStatus, ProfileMotivation } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import type { Row } from "../sql";

/** Motivações do perfil (F12-23): frases por perfil, com estado; a recusada fica guardada. */
export interface ProfileMotivationsRepo {
  get(id: string): ProfileMotivation | null;
  /** Na ordem em que foram criadas. */
  list(profileId: string): ProfileMotivation[];
  add(
    input: {
      profileId: string;
      text: string;
      status: MotivationStatus;
      source: MotivationSource;
      assumption?: string | null;
    },
    now?: Date,
  ): ProfileMotivation;
  /** Editar o texto aceita a frase (a pessoa a escreveu do jeito dela). */
  update(
    id: string,
    patch: { text?: string | undefined; status?: MotivationStatus | undefined },
    now?: Date,
  ): ProfileMotivation;
  remove(id: string): void;
  /** Quando a pessoa revisou as sugestões do perfil (mesmo sem aceitar nenhuma). */
  reviewedAt(profileId: string): string | null;
  markReviewed(profileId: string, now?: Date): void;
}

const map = (r: Row): ProfileMotivation => ({
  id: String(r.id),
  profileId: String(r.profile_id),
  text: String(r.text),
  status: String(r.status) as MotivationStatus,
  source: String(r.source) as MotivationSource,
  assumption: r.assumption === null || r.assumption === undefined ? null : String(r.assumption),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export function profileMotivationsRepo(db: Db): ProfileMotivationsRepo {
  const get = (id: string) => {
    const r = db.prepare("select * from profile_motivation where id = ?").get(id) as
      | Row
      | undefined;
    return r ? map(r) : null;
  };
  return {
    get,
    list(profileId) {
      return (
        db
          .prepare(
            "select * from profile_motivation where profile_id = ? order by created_at, rowid",
          )
          .all(profileId) as Row[]
      ).map(map);
    },
    add(input, now = new Date()) {
      const id = newId();
      const at = now.toISOString();
      db.prepare(
        `insert into profile_motivation (id, profile_id, text, status, source, assumption, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.profileId,
        input.text,
        input.status,
        input.source,
        input.assumption ?? null,
        at,
        at,
      );
      return get(id) as ProfileMotivation;
    },
    update(id, patch, now = new Date()) {
      const cur = get(id);
      if (!cur) throw new Error(`motivação ${id} não existe`);
      const text = patch.text ?? cur.text;
      const status = patch.status ?? (patch.text !== undefined ? "accepted" : cur.status);
      db.prepare(
        "update profile_motivation set text = ?, status = ?, updated_at = ? where id = ?",
      ).run(text, status, now.toISOString(), id);
      return get(id) as ProfileMotivation;
    },
    remove(id) {
      db.prepare("delete from profile_motivation where id = ?").run(id);
    },
    reviewedAt(profileId) {
      const r = db
        .prepare("select motivations_reviewed_at as at from profile where id = ?")
        .get(profileId) as Row | undefined;
      return r?.at ? String(r.at) : null;
    },
    markReviewed(profileId, now = new Date()) {
      db.prepare("update profile set motivations_reviewed_at = ? where id = ?").run(
        now.toISOString(),
        profileId,
      );
    },
  };
}
