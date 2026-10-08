import {
  type Link,
  nowUtc,
  type Phone,
  type Relocation,
  type RemotePref,
  type User,
  UserSchema,
  type WorkAuth,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { json, omit, type Row, str } from "../sql";

/** Registro do usuário único como está no banco: contato pode estar incompleto até o passo 4 do onboarding. */
export interface UserRecord {
  id: string;
  displayName: string | null;
  fullName: string | null;
  pronouns: string | null;
  email: string | null;
  phone: Phone | null;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string | null;
  remotePref: RemotePref | null;
  relocation: Relocation | null;
  workAuth: WorkAuth[] | null;
  links: Link[];
  createdAt: string;
  updatedAt: string;
}

export type UserPatch = Partial<Omit<UserRecord, "id" | "createdAt" | "updatedAt">>;

export interface UsersRepo {
  get(): UserRecord | null;
  count(): number;
  /** Cria no primeiro uso, atualiza nos seguintes (campos `undefined` são ignorados). */
  upsert(patch: UserPatch): UserRecord;
  /** Garante o usuário único e devolve o id (fatos precisam de `user_id`). */
  ensureId(): string;
  appendLinks(links: Link[]): UserRecord;
  /** Valida contra `UserSchema`; lança ZodError se o contato estiver incompleto. */
  complete(): User;
}

function map(r: Row): UserRecord {
  const e164 = str(r.phone_e164);
  return {
    id: String(r.id),
    displayName: str(r.display_name),
    fullName: str(r.full_name),
    pronouns: str(r.pronouns),
    email: str(r.email),
    phone: e164
      ? { e164, country: String(r.phone_country), national: String(r.phone_national) }
      : null,
    city: str(r.city),
    region: str(r.region),
    country: str(r.country),
    timezone: str(r.timezone),
    remotePref: str(r.remote_pref) as RemotePref | null,
    relocation: json<Relocation | null>(r.relocation_json, null),
    workAuth: json<WorkAuth[] | null>(r.work_auth_json, null),
    links: json<Link[]>(r.links_json, []),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function usersRepo(db: Db): UsersRepo {
  const selectOne = db.prepare("select * from user order by created_at limit 1");
  const countStmt = db.prepare("select count(*) as n from user");
  const insert = db.prepare(
    `insert into user (id, display_name, full_name, pronouns, email, phone_e164, phone_country, phone_national, city, region,
       country, timezone, remote_pref, relocation_json, work_auth_json, links_json, created_at, updated_at)
     values (@id, @display_name, @full_name, @pronouns, @email, @phone_e164, @phone_country, @phone_national, @city, @region,
       @country, @timezone, @remote_pref, @relocation_json, @work_auth_json, @links_json, @created_at, @updated_at)`,
  );
  const update = db.prepare(
    `update user set display_name = @display_name, full_name = @full_name, pronouns = @pronouns, email = @email,
       phone_e164 = @phone_e164, phone_country = @phone_country, phone_national = @phone_national, city = @city,
       region = @region, country = @country, timezone = @timezone, remote_pref = @remote_pref,
       relocation_json = @relocation_json, work_auth_json = @work_auth_json, links_json = @links_json,
       updated_at = @updated_at where id = @id`,
  );

  function toParams(u: UserRecord) {
    return {
      id: u.id,
      display_name: u.displayName,
      full_name: u.fullName,
      pronouns: u.pronouns,
      email: u.email,
      phone_e164: u.phone?.e164 ?? null,
      phone_country: u.phone?.country ?? null,
      phone_national: u.phone?.national ?? null,
      city: u.city,
      region: u.region,
      country: u.country,
      timezone: u.timezone,
      remote_pref: u.remotePref,
      relocation_json: u.relocation ? JSON.stringify(u.relocation) : null,
      work_auth_json: u.workAuth ? JSON.stringify(u.workAuth) : null,
      links_json: JSON.stringify(u.links),
      created_at: u.createdAt,
      updated_at: u.updatedAt,
    };
  }

  const repo: UsersRepo = {
    get() {
      const row = selectOne.get() as Row | undefined;
      return row ? map(row) : null;
    },
    count() {
      return (countStmt.get() as { n: number }).n;
    },
    upsert(patch) {
      const now = nowUtc();
      const current = repo.get();
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as UserPatch;
      if (!current) {
        const record: UserRecord = {
          id: newId(),
          displayName: null,
          fullName: null,
          pronouns: null,
          email: null,
          phone: null,
          city: null,
          region: null,
          country: null,
          timezone: null,
          remotePref: null,
          relocation: null,
          workAuth: null,
          links: [],
          ...defined,
          createdAt: now,
          updatedAt: now,
        };
        insert.run(toParams(record));
        return record;
      }
      const merged: UserRecord = { ...current, ...defined, updatedAt: now };
      update.run(omit(toParams(merged), ["created_at"]));
      return merged;
    },
    ensureId() {
      return (repo.get() ?? repo.upsert({})).id;
    },
    appendLinks(links) {
      const current = repo.get() ?? repo.upsert({});
      const seen = new Set(current.links.map((l) => l.url));
      const next = [...current.links];
      for (const l of links) {
        if (!seen.has(l.url)) {
          next.push(l);
          seen.add(l.url);
        }
      }
      return repo.upsert({ links: next });
    },
    complete() {
      const record = repo.get();
      if (!record) throw new Error("Usuário ainda não criado");
      const candidate = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null));
      return UserSchema.parse(candidate);
    },
  };
  return repo;
}
