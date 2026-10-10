import { join } from "node:path";
import { defaultGhConfigDir, type Repos } from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { nowUtc } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { authMiddleware, enterHandler } from "./auth";
import { apiError } from "./errors";
import type { EventBus } from "./events";
import {
  createFakeDeviceFlow,
  createGhDeviceFlow,
  type DeviceFlowRunner,
  type FakeDeviceFlow,
  type GithubAuthDeps,
} from "./github-auth";
import { createJsonlLogger, type JsonlLogger } from "./log";
import type { QueueAdapter } from "./queue";
import { backupsRoutes } from "./routes/backups";
import { dashboardRoutes } from "./routes/dashboard";
import { filesRoutes } from "./routes/files";
import { githubRoutes } from "./routes/github";
import { ingestionsRoutes } from "./routes/ingestions";
import { jobsRoutes } from "./routes/jobs";
import { notificationsRoutes } from "./routes/notifications";
import { onboardingRoutes } from "./routes/onboarding";
import { profilesRoutes } from "./routes/profiles";
import { providerRoutes } from "./routes/provider";
import { reposRoutes } from "./routes/repos";
import { salaryReferenceRoutes } from "./routes/salary-reference";
import { snapshotsRoutes } from "./routes/snapshots";
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
  /** Pasta do `gh` (volume `gh-auth`): `host-token` do lançador e login próprio (F03-1). */
  ghConfigDir?: string;
  /** Fluxo de dispositivo do GitHub; padrão: real, ou falso com o provider mock. */
  deviceFlow?: DeviceFlowRunner;
  /** Pasta de backups (F03-fix L1); `null` = desligado; ausente = `<dados>/backups`. */
  backupDir?: string | null;
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

  const fake = deps.provider.id === "mock";
  const ghConfigDir = deps.ghConfigDir ?? defaultGhConfigDir();
  const githubAuth: GithubAuthDeps = {
    repos: deps.repos,
    dataDir: deps.dataDir,
    configDir: ghConfigDir,
    fake,
  };
  const deviceFlow =
    deps.deviceFlow ??
    (fake ? createFakeDeviceFlow(deps.dataDir) : createGhDeviceFlow({ configDir: ghConfigDir }));

  app.route(
    "/",
    providerRoutes({
      provider: deps.provider,
      bus: deps.bus,
      repos: deps.repos,
      dataDir: deps.dataDir,
      deviceFlow: fake && "complete" in deviceFlow ? (deviceFlow as FakeDeviceFlow) : null,
      githubAuth,
    }),
  );
  app.route(
    "/",
    githubRoutes({
      repos: deps.repos,
      provider: deps.provider,
      bus: deps.bus,
      auth: githubAuth,
      deviceFlow,
    }),
  );
  app.route("/", onboardingRoutes({ repos: deps.repos }));
  app.route("/", filesRoutes({ repos: deps.repos, dataDir: deps.dataDir }));
  app.route(
    "/",
    backupsRoutes({
      repos: deps.repos,
      backupDir: deps.backupDir === undefined ? join(deps.dataDir, "backups") : deps.backupDir,
    }),
  );
  app.route(
    "/",
    ingestionsRoutes({
      repos: deps.repos,
      dataDir: deps.dataDir,
      provider: deps.provider,
      queue: deps.queue,
      bus: deps.bus,
    }),
  );
  app.route("/", jobsRoutes({ repos: deps.repos, queue: deps.queue }));
  app.route(
    "/",
    reposRoutes({ repos: deps.repos, provider: deps.provider, queue: deps.queue, bus: deps.bus }),
  );
  app.route("/", notificationsRoutes({ repos: deps.repos, bus: deps.bus }));
  app.route("/", snapshotsRoutes({ repos: deps.repos, dataDir: deps.dataDir, bus: deps.bus }));
  app.route("/", usageRoutes({ repos: deps.repos }));
  app.route("/", userRoutes({ repos: deps.repos, bus: deps.bus }));
  app.route("/", profilesRoutes({ repos: deps.repos, bus: deps.bus, queue: deps.queue }));
  app.route("/", salaryReferenceRoutes({ repos: deps.repos }));
  app.route("/", dashboardRoutes({ repos: deps.repos, bus: deps.bus }));

  app.notFound((c) => apiError(c, 404, "not_found", "Rota não encontrada"));
  return app;
}

export type App = ReturnType<typeof createApp>;
