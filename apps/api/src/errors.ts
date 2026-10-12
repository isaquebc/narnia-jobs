import { GhError, IngestError, ProfileError, ProposalReviewError } from "@narnia-jobs/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiErrorBody = {
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return c.json(body, status);
}

const PROFILE_ERROR_STATUS: Record<ProfileError["code"], ContentfulStatusCode> = {
  profile_not_found: 404,
  fact_not_found: 404,
  suggestion_not_found: 404,
  profile_active: 409,
  profile_archived: 409,
  fact_foreign: 400,
  unsupported_kind: 400,
  profile_not_in_session: 403,
};

/** Erro tipado do domínio de perfis (F02) → resposta HTTP; outros erros voltam para o `onError`. */
export function profileErrorResponse(c: Context, e: unknown) {
  if (e instanceof ProfileError)
    return apiError(c, PROFILE_ERROR_STATUS[e.code] ?? 400, e.code, e.message);
  throw e;
}

const INGEST_ERROR_STATUS: Record<IngestError["code"], ContentfulStatusCode> = {
  run_not_found: 404,
  file_not_found: 404,
  text_not_found: 404,
  run_closed: 409,
  invalid_state: 409,
};

const GH_ERROR: Record<GhError["code"], { status: ContentfulStatusCode; code: string }> = {
  not_authenticated: { status: 409, code: "github_not_connected" },
  rate_limited: { status: 429, code: "github_rate_limited" },
  not_found: { status: 404, code: "github_not_found" },
  empty: { status: 409, code: "github_repo_empty" },
  unavailable: { status: 503, code: "github_unavailable" },
  failed: { status: 502, code: "github_failed" },
};

const REVIEW_ERROR_STATUS: Record<ProposalReviewError["code"], ContentfulStatusCode> = {
  unknown_proposal: 404,
  foreign_proposal: 409,
  missing_edit: 400,
  conflict_unresolved: 422,
};

/**
 * Erros da ingestão (F03) → HTTP. `GhError` nunca carrega o token (mensagens já saneadas pelo cliente); a falta
 * de login do GitHub é 409, não 401, para não confundir com a sessão da própria api.
 */
export function ingestErrorResponse(c: Context, e: unknown) {
  if (e instanceof IngestError)
    return apiError(c, INGEST_ERROR_STATUS[e.code] ?? 400, e.code, e.message);
  if (e instanceof ProposalReviewError) {
    return apiError(c, REVIEW_ERROR_STATUS[e.code] ?? 400, e.code, e.message);
  }
  if (e instanceof GhError) {
    const m = GH_ERROR[e.code];
    return apiError(
      c,
      m.status,
      m.code,
      e.message,
      e.retryAfterSec !== null ? { retryAfterSec: e.retryAfterSec } : undefined,
    );
  }
  throw e;
}
