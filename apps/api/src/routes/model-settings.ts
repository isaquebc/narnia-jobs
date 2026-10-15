import { POSTING_MODEL_DEFAULTS, type Repos, resolveModel } from "@narnia-jobs/core";
import { POSTING_MODEL_KEYS, type PostingModels, PostingModelsSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { validate } from "./validate";

/**
 * Configurações › Modelos (F06-5, F06-13): modelo por tarefa da vaga, só Claude. Grava em `settings.models.<chave>`
 * (o mesmo lugar que `resolveModel` lê), sem apagar as outras chaves de `models`.
 */
export function modelSettingsRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  const view = (): { models: PostingModels; defaults: PostingModels } => ({
    models: Object.fromEntries(
      POSTING_MODEL_KEYS.map((k) => [
        k,
        resolveModel(deps.repos.settings, k, POSTING_MODEL_DEFAULTS[k]),
      ]),
    ) as PostingModels,
    defaults: { ...POSTING_MODEL_DEFAULTS },
  });
  app.get("/api/settings/models", (c) => c.json(view()));
  app.put("/api/settings/models", validate("json", PostingModelsSchema.partial()), (c) => {
    const current = deps.repos.settings.get<Record<string, unknown>>("models") ?? {};
    deps.repos.settings.set("models", { ...current, ...c.req.valid("json") });
    return c.json(view());
  });
  return app;
}
