import {
  nowUtc,
  type ProfileSuggestion,
  type ProfileSuggestionPayload,
  ProfileSuggestionPayloadSchema,
  ProfileSuggestionSchema,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { ProfileError } from "../../profile/errors";
import type { Db } from "../open";
import { json, type Row, str } from "../sql";
import type { UsersRepo } from "./users";

export interface SuggestionCreateInput {
  source: ProfileSuggestion["source"];
  model?: string | null;
  payload: ProfileSuggestionPayload;
}

export interface SuggestionsRepo {
  /** Grava a sugestão; devolve null (sem gravar) se já existe uma com o mesmo título normalizado, em qualquer status. */
  create(input: SuggestionCreateInput): ProfileSuggestion | null;
  get(id: string): ProfileSuggestion | null;
  list(filter?: { status?: ProfileSuggestion["status"] }): ProfileSuggestion[];
  dismiss(id: string): ProfileSuggestion;
  accept(id: string): ProfileSuggestion;
  hasTitle(title: string): boolean;
  /** Títulos normalizados já dispensados (a heurística não os propõe de novo). */
  dismissedTitles(): string[];
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function map(r: Row): ProfileSuggestion {
  return ProfileSuggestionSchema.parse({
    id: String(r.id),
    userId: String(r.user_id),
    source: String(r.source),
    model: str(r.model),
    payload: json(r.payload_json, {}),
    status: String(r.status),
    createdAt: String(r.created_at),
    decidedAt: str(r.decided_at),
  });
}

export function suggestionsRepo(db: Db, users: UsersRepo): SuggestionsRepo {
  const insert = db.prepare(
    `insert into profile_suggestion (id, user_id, source, model, title_normalized, payload_json, status, created_at, decided_at)
     values (@id, @user_id, @source, @model, @title_normalized, @payload_json, 'new', @created_at, null)`,
  );
  const getStmt = db.prepare("select * from profile_suggestion where id = ?");
  const listAll = db.prepare("select * from profile_suggestion order by created_at, rowid");
  const listStatus = db.prepare(
    "select * from profile_suggestion where status = ? order by created_at, rowid",
  );
  const byTitle = db.prepare(
    "select id from profile_suggestion where user_id = ? and title_normalized = ?",
  );
  const decide = db.prepare(
    "update profile_suggestion set status = ?, decided_at = ? where id = ?",
  );
  const dismissed = db.prepare(
    "select title_normalized from profile_suggestion where status = 'dismissed' order by created_at, rowid",
  );

  function setStatus(id: string, status: ProfileSuggestion["status"]): ProfileSuggestion {
    if (!getStmt.get(id)) {
      throw new ProfileError("suggestion_not_found", `Sugestão não encontrada: ${id}`);
    }
    decide.run(status, nowUtc(), id);
    return map(getStmt.get(id) as Row);
  }

  return {
    create(input) {
      const payload = ProfileSuggestionPayloadSchema.parse(input.payload);
      const userId = users.ensureId();
      const titleNormalized = normalizeTitle(payload.title);
      if (byTitle.get(userId, titleNormalized)) return null;
      const id = newId();
      insert.run({
        id,
        user_id: userId,
        source: input.source,
        model: input.model ?? null,
        title_normalized: titleNormalized,
        payload_json: JSON.stringify(payload),
        created_at: nowUtc(),
      });
      return map(getStmt.get(id) as Row);
    },
    get(id) {
      const row = getStmt.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    list(filter) {
      const rows = (filter?.status ? listStatus.all(filter.status) : listAll.all()) as Row[];
      return rows.map(map);
    },
    dismiss(id) {
      return setStatus(id, "dismissed");
    },
    accept(id) {
      return setStatus(id, "accepted");
    },
    hasTitle(title) {
      return Boolean(byTitle.get(users.ensureId(), normalizeTitle(title)));
    },
    dismissedTitles() {
      return (dismissed.all() as Array<{ title_normalized: string }>).map(
        (r) => r.title_normalized,
      );
    },
  };
}
