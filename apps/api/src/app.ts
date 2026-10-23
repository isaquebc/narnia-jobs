import { join } from "node:path";
import { defaultGhConfigDir, type Repos } from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { nowUtc } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { authMiddleware, enterHandler } from "./auth";
import { bridgeRoutes } from "./bridge/anthropic";
import { SessionManager } from "./chat/session-manager";
import { apiError } from "./errors";
import { syncApproved } from "./evals/approved-sync";
import { syncEvaluators } from "./evals/eval-sync";
import { bridgeUrlForPhoenix, createPhoenixAdmin, phoenixBaseUrl } from "./evals/phoenix-admin";
import { gitCommit } from "./evals/phoenix-setup";
import { promptCatalog } from "./evals/prompt-catalog";
import { syncPrompts } from "./evals/prompt-sync";
import type { EventBus } from "./events";
import {
  createFakeDeviceFlow,
  createGhDeviceFlow,
  type DeviceFlowRunner,
  type FakeDeviceFlow,
  type GithubAuthDeps,
} from "./github-auth";
import { allowedHostsFromEnv, hostGuard } from "./hosts";
import { createJsonlLogger, type JsonlLogger } from "./log";
import { probeMcp } from "./mcp/probe";
import { mcpRoutes } from "./mcp/server";
import type { QueueAdapter } from "./queue";
import { backupsRoutes } from "./routes/backups";
import { chatRoutes } from "./routes/chat";
import { chatSettingsRoutes } from "./routes/chat-settings";
import { dashboardRoutes } from "./routes/dashboard";
import { documentsRoutes } from "./routes/documents";
import { evalsSettingsRoutes } from "./routes/evals-settings";
import { extensionRoutes, watchCaptureAnalyses } from "./routes/extension";
import { filesRoutes } from "./routes/files";
import { githubRoutes } from "./routes/github";
import { ingestionsRoutes } from "./routes/ingestions";
import { jobsRoutes } from "./routes/jobs";
import { modelSettingsRoutes } from "./routes/model-settings";
import { notificationsRoutes } from "./routes/notifications";
import { onboardingRoutes } from "./routes/onboarding";
import { personaCardRoutes } from "./routes/persona-card";
import { pluginStatusRoutes } from "./routes/plugin-status";
import { postingsRoutes } from "./routes/postings";
import { profilesRoutes } from "./routes/profiles";
import { providerRoutes } from "./routes/provider";
import { reposRoutes } from "./routes/repos";
import { salaryReferenceRoutes } from "./routes/salary-reference";
import { snapshotsRoutes } from "./routes/snapshots";
import { usageRoutes } from "./routes/usage";
import { userRoutes } from "./routes/user";
import { workerSettingsRoutes } from "./routes/worker-settings";

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
  /** Sessões de chat (F04 M3); ausente = gerenciador padrão apontando para o `/mcp` deste api. */
  sessions?: SessionManager;
  /** Sonda do `/mcp` para Configurações › Modo plugin; padrão: a própria app, em memória, com o token de boot. */
  mcpProbe?: () => Promise<number>;
  /** Origem do Phoenix (Configurações › Avaliações); ausente = do ambiente, null = sem Phoenix (testes). */
  phoenixUrl?: string | null;
  /** Hosts aceitos (DNS rebinding); ausente = padrões + NARNIA_PUBLIC_URL + NARNIA_ALLOWED_HOSTS. */
  allowedHosts?: Set<string>;
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
  app.use("*", hostGuard(deps.allowedHosts ?? allowedHostsFromEnv(process.env)));
  app.use(
    "*",
    authMiddleware(deps.token, {
      find: (t) => deps.repos.extension.findByToken(t),
      touch: (id) => deps.repos.extension.touch(id),
    }),
  );
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
  // F04: servidor MCP (/mcp) e a rota do hook SessionStart (antes das rotas de perfil, que têm /:id)
  app.route(
    "/",
    mcpRoutes({
      repos: deps.repos,
      dataDir: deps.dataDir,
      provider: deps.provider,
      queue: deps.queue,
      bus: deps.bus,
      version: deps.version,
      // a conversa nova da análise (F06) vem do SessionManager, montado mais abaixo
      openAnalysis: (postingId) => sessions.openPostingAnalysis(postingId),
    }),
  );
  app.route("/", personaCardRoutes({ repos: deps.repos }));
  // avaliações no Phoenix (AV-2): ponte da assinatura, com chave própria (fora do /api)
  app.route("/", bridgeRoutes({ repos: deps.repos, provider: deps.provider }));
  {
    const phoenixUrl =
      deps.phoenixUrl === undefined ? phoenixBaseUrl(process.env) : deps.phoenixUrl;
    const admin = phoenixUrl ? createPhoenixAdmin({ baseUrl: phoenixUrl }) : null;
    app.route(
      "/",
      evalsSettingsRoutes({
        repos: deps.repos,
        bridgeUrl: bridgeUrlForPhoenix(process.env),
        phoenixUrl,
        admin,
        syncPrompts:
          phoenixUrl && admin
            ? async () => {
                const customProviderId = (await admin.status()).providerId;
                return {
                  prompts: await syncPrompts(promptCatalog(), {
                    baseUrl: phoenixUrl,
                    customProviderId,
                    commit: gitCommit(),
                  }),
                  evaluators: await syncEvaluators({ baseUrl: phoenixUrl, customProviderId }),
                  // versões aprovadas do git (AV-6) depois dos datasets, que elas usam
                  approved: await syncApproved({ baseUrl: phoenixUrl }),
                };
              }
            : null,
      }),
    );
  }
  app.route("/", chatSettingsRoutes({ repos: deps.repos }));
  app.route(
    "/",
    extensionRoutes({
      repos: deps.repos,
      version: deps.version,
      token: deps.token,
      dataDir: deps.dataDir,
      queue: deps.queue,
      bus: deps.bus,
      // o SessionManager é montado mais abaixo
      openAnalysis: (postingId) => sessions.openPostingAnalysis(postingId),
    }),
  );
  app.route("/", modelSettingsRoutes({ repos: deps.repos }));
  app.route(
    "/",
    pluginStatusRoutes({
      repos: deps.repos,
      publicUrl: process.env.NARNIA_PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}`,
      // a mesma conversa do Claude Code (initialize + tools/list), sem rede: pela própria app com o token de boot
      mcpProbe:
        deps.mcpProbe ??
        (() =>
          probeMcp("http://127.0.0.1", deps.token, (url, init) =>
            Promise.resolve(app.fetch(new Request(url, init))),
          )),
    }),
  );
  const sessions =
    deps.sessions ??
    new SessionManager({
      repos: deps.repos,
      provider: deps.provider,
      bus: deps.bus,
      token: deps.token,
      mcpUrl: `http://127.0.0.1:${process.env.PORT ?? 3100}/mcp`,
    });
  app.route("/", chatRoutes({ repos: deps.repos, sessions }));
  // F12/M2: "Salvar vaga" na janela da extensão analisa quando a extração termina
  watchCaptureAnalyses({
    repos: deps.repos,
    bus: deps.bus,
    openAnalysis: (postingId) => sessions.openPostingAnalysis(postingId),
  });
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
  app.route(
    "/",
    postingsRoutes({ repos: deps.repos, bus: deps.bus, queue: deps.queue, dataDir: deps.dataDir }),
  );
  app.route(
    "/",
    documentsRoutes({ repos: deps.repos, bus: deps.bus, queue: deps.queue, dataDir: deps.dataDir }),
  );
  app.route("/", snapshotsRoutes({ repos: deps.repos, dataDir: deps.dataDir, bus: deps.bus }));
  app.route("/", usageRoutes({ repos: deps.repos }));
  app.route("/", workerSettingsRoutes({ repos: deps.repos }));
  app.route("/", userRoutes({ repos: deps.repos, bus: deps.bus }));
  app.route("/", profilesRoutes({ repos: deps.repos, bus: deps.bus, queue: deps.queue }));
  app.route("/", salaryReferenceRoutes({ repos: deps.repos }));
  app.route("/", dashboardRoutes({ repos: deps.repos, bus: deps.bus }));

  app.notFound((c) => apiError(c, 404, "not_found", "Rota não encontrada"));
  return app;
}

export type App = ReturnType<typeof createApp>;
