import { type MediaClient, MediaError } from "@narnia-jobs/core";
import { MediaTokenRequestSchema } from "@narnia-jobs/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError } from "../errors";
import { validate } from "./validate";

/**
 * F13 · Configurações › Análise de vídeo (plans/plan-v0/tasks/done/F13 §6.1.1, R2 e R4): estado do serviço `media` e token
 * do Hugging Face. O token vai direto ao `media` (arquivo 0600 no volume dele): não passa pelo banco, não é logado e
 * nunca volta numa resposta.
 */
export function mediaRoutes(deps: { media: MediaClient }) {
  const app = new Hono();
  const fail = (c: Context, err: unknown) => {
    if (err instanceof MediaError)
      return apiError(c, err.status as ContentfulStatusCode, err.code, err.message);
    throw err;
  };

  app.get("/api/media/status", async (c) => c.json(await deps.media.status()));

  app.put("/api/media/token", validate("json", MediaTokenRequestSchema), async (c) => {
    try {
      await deps.media.setToken(c.req.valid("json").token);
    } catch (err) {
      return fail(c, err);
    }
    return c.json(await deps.media.status());
  });

  app.delete("/api/media/token", async (c) => {
    try {
      await deps.media.deleteToken();
    } catch (err) {
      return fail(c, err);
    }
    return c.json(await deps.media.status());
  });
  return app;
}
