import { ProfileError } from "@narnia-jobs/core";
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
};

/** Erro tipado do domínio de perfis (F02) → resposta HTTP; outros erros voltam para o `onError`. */
export function profileErrorResponse(c: Context, e: unknown) {
  if (e instanceof ProfileError)
    return apiError(c, PROFILE_ERROR_STATUS[e.code] ?? 400, e.code, e.message);
  throw e;
}
