import {
  type EmphasisFactKind,
  EmphasisFactKindSchema,
  type EmphasisItem,
  EmphasisItemSchema,
  nowUtc,
  type ProfileEmphasis,
  ProfileEmphasisSchema,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { ProfileError } from "../../profile/errors";
import { type Db, withTransaction } from "../open";
import { num, type Row } from "../sql";

export interface EmphasisRepo {
  list(profileId: string): ProfileEmphasis[];
  /** Substitui o conjunto de ênfases do perfil; valida dono e existência de cada fato; renumera `position` por tipo. */
  replace(
    profileId: string,
    items: EmphasisItem[],
    opts?: { kinds?: EmphasisFactKind[] },
  ): { updated: number };
  removeFact(kind: EmphasisFactKind, factId: string): void;
  countByMode(profileId: string): { highlighted: number; hidden: number };
  /** Copia as ênfases de um perfil para outro (clone, F02-8). */
  copy(fromProfileId: string, toProfileId: string): number;
}

/** Tabela e coluna de dono por tipo de fato; conquista pertence ao usuário pela experiência. */
const OWNER_SQL: Record<EmphasisFactKind, string> = {
  experience: "select user_id from experience where id = ?",
  project: "select user_id from project where id = ?",
  skill: "select user_id from skill where id = ?",
  education: "select user_id from education where id = ?",
  language: "select user_id from language where id = ?",
  achievement:
    "select e.user_id as user_id from achievement a join experience e on e.id = a.experience_id where a.id = ?",
};

function map(r: Row): ProfileEmphasis {
  return ProfileEmphasisSchema.parse({
    id: String(r.id),
    profileId: String(r.profile_id),
    factKind: String(r.fact_kind),
    factId: String(r.fact_id),
    mode: String(r.mode),
    position: num(r.position),
    updatedAt: String(r.updated_at),
  });
}

export function emphasisRepo(db: Db): EmphasisRepo {
  const listStmt = db.prepare(
    "select * from profile_emphasis where profile_id = ? order by fact_kind, position, rowid",
  );
  const profileOwner = db.prepare("select user_id from profile where id = ?");
  const owners = Object.fromEntries(
    EmphasisFactKindSchema.options.map((k) => [k, db.prepare(OWNER_SQL[k])]),
  ) as Record<EmphasisFactKind, ReturnType<Db["prepare"]>>;
  const delAll = db.prepare("delete from profile_emphasis where profile_id = ?");
  const delKind = db.prepare("delete from profile_emphasis where profile_id = ? and fact_kind = ?");
  const delFact = db.prepare("delete from profile_emphasis where fact_kind = ? and fact_id = ?");
  const insert = db.prepare(
    `insert into profile_emphasis (id, profile_id, fact_kind, fact_id, mode, position, updated_at)
     values (@id, @profile_id, @fact_kind, @fact_id, @mode, @position, @updated_at)`,
  );
  // trocar ênfases invalida o cartão do perfil (F02 §2.2, hook explícito)
  const invalidateCard = db.prepare("update profile set card_updated_at = null where id = ?");
  const countStmt = db.prepare(
    `select sum(case when mode = 'highlight' then 1 else 0 end) as highlighted,
            sum(case when mode = 'hidden' then 1 else 0 end) as hidden
       from profile_emphasis where profile_id = ?`,
  );

  function requireProfileOwner(profileId: string): string {
    const row = profileOwner.get(profileId) as { user_id: string } | undefined;
    if (!row) throw new ProfileError("profile_not_found", `Perfil não encontrado: ${profileId}`);
    return row.user_id;
  }

  function assertOwned(userId: string, item: EmphasisItem): void {
    const row = owners[item.kind].get(item.id) as { user_id: string } | undefined;
    if (!row) throw new ProfileError("fact_not_found", `${item.kind} não encontrado: ${item.id}`);
    if (row.user_id !== userId) {
      throw new ProfileError("fact_foreign", `${item.kind} ${item.id} não pertence ao usuário`);
    }
  }

  const repo: EmphasisRepo = {
    list(profileId) {
      return (listStmt.all(profileId) as Row[]).map(map);
    },
    replace(profileId, rawItems, opts) {
      const items = rawItems.map((i) => EmphasisItemSchema.parse(i));
      const userId = requireProfileOwner(profileId);
      // auditoria F02 (3): com `kinds`, só os tipos listados são substituídos; os demais (ex.: conquistas via tool) ficam
      const kinds = opts?.kinds
        ? new Set(opts.kinds.map((k) => EmphasisFactKindSchema.parse(k)))
        : null;
      for (const item of items) {
        assertOwned(userId, item);
        if (kinds && !kinds.has(item.kind))
          throw new ProfileError("unsupported_kind", `Tipo fora de kinds: ${item.kind}`);
      }
      // ordem dentro de cada tipo: posição pedida (estável) e, sem posição, a ordem de chegada ao final
      const byKind = new Map<EmphasisFactKind, Array<{ item: EmphasisItem; idx: number }>>();
      items.forEach((item, idx) => {
        const list = byKind.get(item.kind) ?? [];
        list.push({ item, idx });
        byKind.set(item.kind, list);
      });
      const now = nowUtc();
      return withTransaction(db, () => {
        if (kinds) for (const k of kinds) delKind.run(profileId, k);
        else delAll.run(profileId);
        invalidateCard.run(profileId);
        let updated = 0;
        for (const list of byKind.values()) {
          list.sort((a, b) => {
            const pa = a.item.position ?? Number.MAX_SAFE_INTEGER;
            const pb = b.item.position ?? Number.MAX_SAFE_INTEGER;
            return pa === pb ? a.idx - b.idx : pa - pb;
          });
          list.forEach(({ item }, position) => {
            insert.run({
              id: newId(),
              profile_id: profileId,
              fact_kind: item.kind,
              fact_id: item.id,
              mode: item.mode,
              position,
              updated_at: now,
            });
            updated += 1;
          });
        }
        return { updated };
      });
    },
    removeFact(kind, factId) {
      delFact.run(kind, factId);
    },
    countByMode(profileId) {
      const r = countStmt.get(profileId) as Row;
      return { highlighted: num(r.highlighted) ?? 0, hidden: num(r.hidden) ?? 0 };
    },
    copy(fromProfileId, toProfileId) {
      const now = nowUtc();
      let n = 0;
      for (const e of repo.list(fromProfileId)) {
        insert.run({
          id: newId(),
          profile_id: toProfileId,
          fact_kind: e.factKind,
          fact_id: e.factId,
          mode: e.mode,
          position: e.position,
          updated_at: now,
        });
        n += 1;
      }
      return n;
    },
  };
  return repo;
}

/** Tipos de fato aceitos nas ênfases, para validação externa. */
export const EMPHASIS_KINDS = EmphasisFactKindSchema.options;
