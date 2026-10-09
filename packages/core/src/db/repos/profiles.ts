import {
  nowUtc,
  type PersonaOverrides,
  PersonaOverridesSchema,
  type Profile,
  type ProfileCard,
  ProfileCardSchema,
  type ProfileInput,
  ProfileSchema,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { ProfileError } from "../../profile/errors";
import type { Db } from "../open";
import { withTransaction } from "../open";
import { bool, json, num, omit, type Row, str } from "../sql";
import type { EmphasisRepo } from "./emphasis";

export type ProfileCreate = Omit<ProfileInput, "id">;
/** Campos internos nunca entram por `update` (cartão tem `setCard`; ativo/arquivo têm métodos próprios). */
export type ProfilePatch = Partial<
  Omit<
    ProfileInput,
    | "id"
    | "userId"
    | "isActive"
    | "cardJson"
    | "cardUpdatedAt"
    | "cardFactsVersion"
    | "archivedAt"
    | "clonedFrom"
    | "personaOverrides"
  >
>;
/** Clone (F02-8): dados do novo perfil; ênfases, pitch e persona vêm do perfil de origem. */
export type ProfileCloneInput = Omit<
  ProfileCreate,
  "userId" | "isActive" | "pitch" | "personaOverrides"
>;

export interface ProfileRecord extends Profile {
  createdAt: string;
  updatedAt: string;
}

export interface ProfilesRepo {
  create(input: ProfileCreate): ProfileRecord;
  get(id: string): ProfileRecord | null;
  /** Sem arquivados por padrão (F02-6). */
  list(opts?: { includeArchived?: boolean }): ProfileRecord[];
  /** Edita e invalida o cartão do próprio perfil (F02 §2.2). */
  update(id: string, patch: ProfilePatch): ProfileRecord;
  /** Recusa perfil arquivado (`profile_archived`). */
  setActive(id: string): void;
  active(): ProfileRecord | null;
  archive(id: string): ProfileRecord;
  unarchive(id: string): ProfileRecord;
  clone(sourceId: string, input: ProfileCloneInput): ProfileRecord;
  /** Mescla overrides da persona; `null` apaga a chave; invalida o cartão. */
  updatePersonaOverrides(id: string, overrides: PersonaOverrides): ProfileRecord;
  /** Grava o cache do cartão (`card_json`, `card_updated_at`, `card_facts_version`). */
  setCard(id: string, card: ProfileCard): ProfileRecord;
  /** Marca o cartão como inválido; devolve true se ele estava válido (transição, F02 §2.9-2). */
  invalidateCard(id: string): boolean;
  /** Invalida os cartões de todos os perfis do usuário; devolve os ids que estavam válidos. */
  invalidateCards(userId: string): string[];
}

/** Campos do perfil que aparecem no cartão (F02 §2.2); mudar um deles invalida o cache. */
const CARD_FIELDS = [
  "targetTitle",
  "altTitles",
  "seniority",
  "area",
  "goal",
  "market",
  "docLocale",
  "salary",
  "contractTypes",
  "locations",
  "availableFrom",
  "needsResearch",
  "pitch",
] as const;

export interface ProfilesRepoDeps {
  emphasis?: EmphasisRepo;
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
    cardFactsVersion: num(r.card_facts_version),
    personaOverrides: json<PersonaOverrides>(r.persona_overrides_json, {}),
    archivedAt: str(r.archived_at),
    clonedFrom: str(r.cloned_from),
    isActive: bool(r.is_active),
  });
  return { ...parsed, createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}

export function profilesRepo(db: Db, deps: ProfilesRepoDeps = {}): ProfilesRepo {
  const getStmt = db.prepare("select * from profile where id = ?");
  const listStmt = db.prepare(
    "select * from profile where archived_at is null order by created_at, rowid",
  );
  const listAllStmt = db.prepare("select * from profile order by created_at, rowid");
  const activeStmt = db.prepare("select * from profile where is_active = 1 limit 1");
  const insert = db.prepare(
    `insert into profile (id, user_id, name, target_title, alt_titles_json, seniority, area, goal, market, doc_locale,
       salary_min, salary_max, salary_currency, salary_period, salary_below_reference, contract_types_json, locations_json,
       available_from, needs_research_json, pitch, card_json, card_updated_at, card_facts_version, persona_overrides_json,
       archived_at, cloned_from, is_active, created_at, updated_at)
     values (@id, @user_id, @name, @target_title, @alt_titles_json, @seniority, @area, @goal, @market, @doc_locale,
       @salary_min, @salary_max, @salary_currency, @salary_period, @salary_below_reference, @contract_types_json, @locations_json,
       @available_from, @needs_research_json, @pitch, @card_json, @card_updated_at, @card_facts_version, @persona_overrides_json,
       @archived_at, @cloned_from, @is_active, @created_at, @updated_at)`,
  );
  const update = db.prepare(
    `update profile set name = @name, target_title = @target_title, alt_titles_json = @alt_titles_json, seniority = @seniority,
       area = @area, goal = @goal, market = @market, doc_locale = @doc_locale, salary_min = @salary_min, salary_max = @salary_max,
       salary_currency = @salary_currency, salary_period = @salary_period, salary_below_reference = @salary_below_reference,
       contract_types_json = @contract_types_json, locations_json = @locations_json, available_from = @available_from,
       needs_research_json = @needs_research_json, pitch = @pitch, card_json = @card_json, card_updated_at = @card_updated_at,
       card_facts_version = @card_facts_version, persona_overrides_json = @persona_overrides_json, archived_at = @archived_at,
       cloned_from = @cloned_from, is_active = @is_active, updated_at = @updated_at where id = @id`,
  );
  const setCardStmt = db.prepare(
    "update profile set card_json = ?, card_updated_at = ?, card_facts_version = ?, updated_at = ? where id = ?",
  );
  const invalidateOne = db.prepare(
    "update profile set card_updated_at = null where id = ? and card_updated_at is not null",
  );
  const validByUser = db.prepare(
    "select id from profile where user_id = ? and card_updated_at is not null order by created_at, rowid",
  );
  const invalidateUser = db.prepare(
    "update profile set card_updated_at = null where user_id = ? and card_updated_at is not null",
  );
  const setArchived = db.prepare("update profile set archived_at = ?, updated_at = ? where id = ?");
  const setOverrides = db.prepare(
    "update profile set persona_overrides_json = ?, updated_at = ? where id = ?",
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
      card_facts_version: p.cardFactsVersion ?? null,
      persona_overrides_json: JSON.stringify(p.personaOverrides ?? {}),
      archived_at: p.archivedAt ?? null,
      cloned_from: p.clonedFrom ?? null,
      is_active: p.isActive ? 1 : 0,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  function require(id: string): ProfileRecord {
    const p = repo.get(id);
    if (!p) throw new ProfileError("profile_not_found", `Perfil não encontrado: ${id}`);
    return p;
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
    list(opts) {
      return ((opts?.includeArchived ? listAllStmt : listStmt).all() as Row[]).map(map);
    },
    update(id, patch) {
      const current = require(id);
      const { createdAt, ...base } = current;
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const merged = ProfileSchema.parse({ ...base, ...defined, id, userId: current.userId });
      // auditoria F02 (5): só o que entra no cartão invalida; renomear não
      const changed = CARD_FIELDS.some(
        (k) => JSON.stringify(merged[k] ?? null) !== JSON.stringify(current[k] ?? null),
      );
      const next = changed ? { ...merged, cardUpdatedAt: null } : merged;
      const now = nowUtc();
      update.run(omit(toParams(next, createdAt, now), ["user_id", "created_at"]));
      return repo.get(id) as ProfileRecord;
    },
    setActive(id) {
      withTransaction(db, () => {
        const p = require(id);
        if (p.archivedAt) {
          throw new ProfileError(
            "profile_archived",
            `Perfil arquivado não pode ser ativado: ${id}`,
          );
        }
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
    archive(id) {
      const p = require(id);
      if (p.isActive) {
        throw new ProfileError("profile_active", "Troque de perfil antes de arquivar o ativo");
      }
      if (p.archivedAt) {
        throw new ProfileError("profile_archived", `Perfil já arquivado: ${id}`);
      }
      const now = nowUtc();
      setArchived.run(now, now, id);
      invalidateOne.run(id);
      return repo.get(id) as ProfileRecord;
    },
    unarchive(id) {
      const p = require(id);
      if (!p.archivedAt)
        throw new ProfileError("profile_archived", `Perfil não está arquivado: ${id}`);
      setArchived.run(null, nowUtc(), id);
      invalidateOne.run(id);
      return repo.get(id) as ProfileRecord;
    },
    clone(sourceId, input) {
      const source = require(sourceId);
      // `create` já abre a própria transação (sem aninhar); a cópia das ênfases vem logo depois
      const created = repo.create({
        ...input,
        userId: source.userId,
        isActive: false,
        pitch: source.pitch ?? null,
        personaOverrides: source.personaOverrides ?? {},
        clonedFrom: source.id,
      });
      deps.emphasis?.copy(source.id, created.id);
      return repo.get(created.id) as ProfileRecord;
    },
    updatePersonaOverrides(id, overrides) {
      const p = require(id);
      const patch = PersonaOverridesSchema.parse(overrides);
      const merged: Record<string, unknown> = { ...(p.personaOverrides ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      setOverrides.run(JSON.stringify(PersonaOverridesSchema.parse(merged)), nowUtc(), id);
      return repo.get(id) as ProfileRecord;
    },
    setCard(id, card) {
      require(id);
      const c = ProfileCardSchema.parse(card);
      setCardStmt.run(JSON.stringify(c), c.builtAt, c.factsVersion, nowUtc(), id);
      return repo.get(id) as ProfileRecord;
    },
    invalidateCard(id) {
      require(id);
      const r = invalidateOne.run(id) as { changes: number | bigint };
      return Number(r.changes) > 0;
    },
    invalidateCards(userId) {
      const ids = (validByUser.all(userId) as Array<{ id: string }>).map((r) => r.id);
      if (ids.length > 0) invalidateUser.run(userId);
      return ids;
    },
  };
  return repo;
}
