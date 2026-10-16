import {
  type Repos,
  resolveConcurrency,
  saveConcurrency,
  WORKER_CONCURRENCY_DEFAULTS,
  WORKER_CONCURRENCY_MAX,
  WORKER_CONCURRENCY_MIN,
} from "@narnia-jobs/core";
import { Hono } from "hono";
import { z } from "zod";
import { validate } from "./validate";

/** Configurações › Processos (F05 M7): quantos jobs de cada fila rodam juntos; o worker aplica sem reiniciar. */
const N = z.number().int().min(WORKER_CONCURRENCY_MIN).max(WORKER_CONCURRENCY_MAX);
const PutSchema = z.object({ ingest: N.optional(), ocr: N.optional(), extract: N.optional() });

export function workerSettingsRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  const view = () => ({
    concurrency: resolveConcurrency(deps.repos.settings),
    defaults: WORKER_CONCURRENCY_DEFAULTS,
    min: WORKER_CONCURRENCY_MIN,
    max: WORKER_CONCURRENCY_MAX,
  });
  app.get("/api/settings/workers", (c) => c.json(view()));
  app.put("/api/settings/workers", validate("json", PutSchema), (c) => {
    const body = c.req.valid("json");
    saveConcurrency(
      deps.repos.settings,
      Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    );
    return c.json(view());
  });
  return app;
}
