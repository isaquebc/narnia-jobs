import {
  type EmphasisFactKind,
  nowUtc,
  type ProfileFactRelevance,
  ProfileFactRelevanceSchema,
} from "@narnia-jobs/shared";
import { type Db, withTransaction } from "../open";
import { json, type Row } from "../sql";

export type RelevanceInput = Omit<ProfileFactRelevance, "profileId" | "computedAt">;

export interface RelevanceRepo {
  /** Substitui todas as notas do perfil (calculadas junto com o cartão, F02 §2.3). */
  replaceForProfile(profileId: string, rows: RelevanceInput[], computedAt?: string): number;
  listByProfile(profileId: string): ProfileFactRelevance[];
  clearProfile(profileId: string): void;
  removeFact(kind: EmphasisFactKind, factId: string): void;
}

function map(r: Row): ProfileFactRelevance {
  return ProfileFactRelevanceSchema.parse({
    profileId: String(r.profile_id),
    factKind: String(r.fact_kind),
    factId: String(r.fact_id),
    score: Number(r.score),
    reasons: json<string[]>(r.reasons_json, []),
    computedAt: String(r.computed_at),
  });
}

export function relevanceRepo(db: Db): RelevanceRepo {
  const listStmt = db.prepare(
    "select * from profile_fact_relevance where profile_id = ? order by score desc, fact_kind, fact_id",
  );
  const clear = db.prepare("delete from profile_fact_relevance where profile_id = ?");
  const delFact = db.prepare(
    "delete from profile_fact_relevance where fact_kind = ? and fact_id = ?",
  );
  const insert = db.prepare(
    `insert into profile_fact_relevance (profile_id, fact_kind, fact_id, score, reasons_json, computed_at)
     values (@profile_id, @fact_kind, @fact_id, @score, @reasons_json, @computed_at)`,
  );
  return {
    replaceForProfile(profileId, rows, computedAt = nowUtc()) {
      return withTransaction(db, () => {
        clear.run(profileId);
        for (const r of rows) {
          insert.run({
            profile_id: profileId,
            fact_kind: r.factKind,
            fact_id: r.factId,
            score: r.score,
            reasons_json: JSON.stringify(r.reasons),
            computed_at: computedAt,
          });
        }
        return rows.length;
      });
    },
    listByProfile(profileId) {
      return (listStmt.all(profileId) as Row[]).map(map);
    },
    clearProfile(profileId) {
      clear.run(profileId);
    },
    removeFact(kind, factId) {
      delFact.run(kind, factId);
    },
  };
}
