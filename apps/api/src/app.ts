import type { Repos } from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { nowUtc } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { authMiddleware, enterHandler } from "./auth";
import { apiError } from "./errors";
import type { EventBus } from "./events";
import { createJsonlLogger, type JsonlLogger } from "./log";
import type { QueueAdapter } from "./queue";
import { dashboardRoutes } from "./routes/dashboard";
import { filesRoutes } from "./routes/files";
import { ingestionsRoutes } from "./routes/ingestions";
import { jobsRoutes } from "./routes/jobs";
import { onboardingRoutes } from "./routes/onboarding";
import { profilesRoutes } from "./routes/profiles";
import { providerRoutes } from "./routes/provider";
import { salaryReferenceRoutes } from "./routes/salary-reference";
import { usageRoutes } from "./routes/usage";
import { userRoutes } from "./routes/user";

export interface AppDeps {
  version: string;
  repos: Repos;
  dataDir: string;
  provider: Provider;
  queue: QueueAdapter;
  bus: EventBus;
  token: string;
  log?: JsonlLogger;
}

/** Monta a aplicação Hono (F01 §2.6). Tudo atrás do token de boot, exceto health e a rota de entrada. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  const log = deps.log ?? createJsonlLogger(deps.dataDir, "api");

  app.use("*", async (c, next) => {
    const t0 = Date.now();
    await next();
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/")) {
      log({ ts: nowUtc(), method: c.req.method, path, status: c.res.status, ms: Date.now() - t0 });
    }
  });
  app.use("*", authMiddleware(deps.token));
  app.onError((err, c) => {
    console.error("[api] erro não tratado:", err);
    return apiError(c, 500, "internal", err.message);
  });

  app.get("/api/health", (c) => c.json({ ok: true, version: deps.version }));
  app.get("/api/auth/enter", enterHandler(deps.token));

  app.route(
    "/",
    providerRoutes({
      provider: deps.provider,
      bus: deps.bus,
      repos: deps.repos,
      dataDir: deps.dataDir,
    }),
  );
  app.route("/", onboardingRoutes({ repos: deps.repos }));
  app.route("/", filesRoutes({ repos: deps.repos, dataDir: deps.dataDir }));
  app.route(
    "/",
    ingestionsRoutes({
      repos: deps.repos,
      dataDir: deps.dataDir,
      provider: deps.provider,
      queue: deps.queue,
    }),
  );
  app.route("/", jobsRoutes({ repos: deps.repos, queue: deps.queue }));
  app.route("/", usageRoutes({ repos: deps.repos }));
  app.route("/", userRoutes({ repos: deps.repos }));
  app.route("/", profilesRoutes({ repos: deps.repos }));
  app.route("/", salaryReferenceRoutes({ repos: deps.repos }));
  app.route("/", dashboardRoutes({ repos: deps.repos }));

  app.notFound((c) => apiError(c, 404, "not_found", "Rota não encontrada"));
  return app;
}

export type App = ReturnType<typeof createApp>;
