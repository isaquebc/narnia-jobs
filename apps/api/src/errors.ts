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
