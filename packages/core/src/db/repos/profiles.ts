import { nowUtc, type Profile, type ProfileInput, ProfileSchema } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { withTransaction } from "../open";
import { bool, json, num, omit, type Row, str } from "../sql";

export type ProfileCreate = Omit<ProfileInput, "id">;
export type ProfilePatch = Partial<Omit<ProfileInput, "id" | "userId">>;

export interface ProfileRecord extends Profile {
  createdAt: string;
  updatedAt: string;
}

export interface ProfilesRepo {
  create(input: ProfileCreate): ProfileRecord;
  get(id: string): ProfileRecord | null;
  list(): ProfileRecord[];
  update(id: string, patch: ProfilePatch): ProfileRecord;
  setActive(id: string): void;
  active(): ProfileRecord | null;
}

function map(r: Row): ProfileRecord {
  const min = num(r.salary_min);
  const parsed = ProfileSchema.parse({
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    targetTitle: String(r.target_title),
    altTitles: json<string[]>(r.alt_titles_json, []),
    seniority: String(r.seniority),
    area: String(r.area),
    goal: String(r.goal),
    market: String(r.market),
    docLocale: String(r.doc_locale),
    salary:
      min === null
        ? undefined
        : {
            min,
            max: num(r.salary_max) as number,
            currency: String(r.salary_currency),
            period: String(r.salary_period),
          },
    salaryBelowReference: bool(r.salary_below_reference),
    contractTypes: json(r.contract_types_json, []),
    locations: json(r.locations_json, []),
    availableFrom: str(r.available_from) ?? undefined,
    needsResearch: json(r.needs_research_json, []),
    pitch: str(r.pitch),
    cardJson: str(r.card_json),
    cardUpdatedAt: str(r.card_updated_at),
    isActive: bool(r.is_active),
  });
  return { ...parsed, createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}

export function profilesRepo(db: Db): ProfilesRepo {
  const getStmt = db.prepare("select * from profile where id = ?");
  const listStmt = db.prepare("select * from profile order by created_at, rowid");
  const activeStmt = db.prepare("select * from profile where is_active = 1 limit 1");
  const insert = db.prepare(
    `insert into profile (id, user_id, name, target_title, alt_titles_json, seniority, area, goal, market, doc_locale,
       salary_min, salary_max, salary_currency, salary_period, salary_below_reference, contract_types_json, locations_json,
       available_from, needs_research_json, pitch, card_json, card_updated_at, is_active, created_at, updated_at)
     values (@id, @user_id, @name, @target_title, @alt_titles_json, @seniority, @area, @goal, @market, @doc_locale,
       @salary_min, @salary_max, @salary_currency, @salary_period, @salary_below_reference, @contract_types_json, @locations_json,
       @available_from, @needs_research_json, @pitch, @card_json, @card_updated_at, @is_active, @created_at, @updated_at)`,
  );
  const update = db.prepare(
    `update profile set name = @name, target_title = @target_title, alt_titles_json = @alt_titles_json, seniority = @seniority,
       area = @area, goal = @goal, market = @market, doc_locale = @doc_locale, salary_min = @salary_min, salary_max = @salary_max,
       salary_currency = @salary_currency, salary_period = @salary_period, salary_below_reference = @salary_below_reference,
       contract_types_json = @contract_types_json, locations_json = @locations_json, available_from = @available_from,
       needs_research_json = @needs_research_json, pitch = @pitch, card_json = @card_json, card_updated_at = @card_updated_at,
       is_active = @is_active, updated_at = @updated_at where id = @id`,
  );

  function toParams(p: Profile, createdAt: string, updatedAt: string) {
    return {
      id: p.id,
      user_id: p.userId,
      name: p.name,
      target_title: p.targetTitle,
      alt_titles_json: JSON.stringify(p.altTitles),
      seniority: p.seniority,
      area: p.area,
      goal: p.goal,
      market: p.market,
      doc_locale: p.docLocale,
      salary_min: p.salary?.min ?? null,
      salary_max: p.salary?.max ?? null,
      salary_currency: p.salary?.currency ?? null,
      salary_period: p.salary?.period ?? null,
      salary_below_reference: p.salaryBelowReference ? 1 : 0,
      contract_types_json: JSON.stringify(p.contractTypes),
      locations_json: JSON.stringify(p.locations),
      available_from: p.availableFrom ?? null,
      needs_research_json: JSON.stringify(p.needsResearch),
      pitch: p.pitch ?? null,
      card_json: p.cardJson ?? null,
      card_updated_at: p.cardUpdatedAt ?? null,
      is_active: p.isActive ? 1 : 0,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  const repo: ProfilesRepo = {
    create(input) {
      const now = nowUtc();
      const profile = ProfileSchema.parse({ ...input, id: newId() });
      return withTransaction(db, () => {
        if (profile.isActive) db.exec("update profile set is_active = 0");
        insert.run(toParams(profile, now, now));
        return repo.get(profile.id) as ProfileRecord;
      });
    },
    get(id) {
      const row = getStmt.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    list() {
      return (listStmt.all() as Row[]).map(map);
    },
    update(id, patch) {
      const current = repo.get(id);
      if (!current) throw new Error(`Perfil não encontrado: ${id}`);
      const { createdAt, ...base } = current;
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const next = ProfileSchema.parse({ ...base, ...defined, id, userId: current.userId });
      const now = nowUtc();
      update.run(omit(toParams(next, createdAt, now), ["user_id", "created_at"]));
      return repo.get(id) as ProfileRecord;
    },
    setActive(id) {
      withTransaction(db, () => {
        if (!repo.get(id)) throw new Error(`Perfil não encontrado: ${id}`);
        db.exec("update profile set is_active = 0");
        db.prepare("update profile set is_active = 1, updated_at = ? where id = ?").run(
          nowUtc(),
          id,
        );
      });
    },
    active() {
      const row = activeStmt.get() as Row | undefined;
      return row ? map(row) : null;
    },
  };
  return repo;
}
