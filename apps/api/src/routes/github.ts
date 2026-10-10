import {
  INGEST_SETTING_KEYS,
  previewGithub,
  type Repos,
  resolveIngestSettings,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import {
  GithubAuthPutRequestSchema,
  GithubPreviewRequestSchema,
  IngestSettingsPutRequestSchema,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import { ingestErrorResponse } from "../errors";
import type { EventBus } from "../events";
import {
  type DeviceFlowRunner,
  type GithubAuthDeps,
  ghClient,
  githubAuthStatus,
  markAppConnected,
} from "../github-auth";
import { validate } from "./validate";

/**
 * Conexão do GitHub, seletor de repositórios, diagnóstico do plano e configurações da ingestão (F03 §2.10).
 * O token do GitHub nunca aparece em resposta, log ou evento.
 */
export function githubRoutes(deps: {
  repos: Repos;
  provider: Provider;
  bus: EventBus;
  auth: GithubAuthDeps;
  deviceFlow: DeviceFlowRunner;
}) {
  const app = new Hono();

  app.get("/api/github/auth", async (c) => c.json(await githubAuthStatus(deps.auth)));

  app.put("/api/github/auth", validate("json", GithubAuthPutRequestSchema), async (c) => {
    deps.repos.settings.set(INGEST_SETTING_KEYS.githubAuth, c.req.valid("json").source);
    return c.json(await githubAuthStatus(deps.auth));
  });

  app.post("/api/github/auth/device", async (c) => {
    try {
      const session = await deps.deviceFlow.start((r) => {
        if (r.ok) markAppConnected(deps.repos);
        void githubAuthStatus(deps.auth).then((status) =>
          deps.bus.emit({
            type: "github.auth_updated",
            status,
            ...(r.error ? { error: r.error } : {}),
          }),
        );
      });
      return c.json(session, 202);
    } catch (e) {
      return ingestErrorResponse(c, e);
    }
  });

  app.delete("/api/github/auth", async (c) => {
    await deps.deviceFlow.logout();
    const status = await githubAuthStatus(deps.auth);
    deps.bus.emit({ type: "github.auth_updated", status });
    return c.json(status);
  });

  app.post(
    "/api/sources/github/preview",
    validate("json", GithubPreviewRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const p = await previewGithub(ghClient(deps.auth), {
          mode: body.mode,
          login: body.login ?? null,
        });
        return c.json({
          mode: body.mode,
          authenticated: p.authenticated,
          rateLimited: false,
          groups: p.groups,
        });
      } catch (e) {
        return ingestErrorResponse(c, e);
      }
    },
  );

  app.get("/api/plan/usage", async (c) => {
    const usage = await deps.provider.getPlanUsage().catch(() => null);
    return c.json({ usage });
  });

  app.get("/api/settings/ingest", (c) => {
    // FX-4: a conversão aprendida % → tokens por modelo vai para a interface (só leitura; PUT não a aceita)
    return c.json(resolveIngestSettings(deps.repos.settings));
  });

  app.put("/api/settings/ingest", validate("json", IngestSettingsPutRequestSchema), (c) => {
    const body = c.req.valid("json");
    for (const [field, value] of Object.entries(body)) {
      const key = INGEST_SETTING_KEYS[field as keyof typeof INGEST_SETTING_KEYS];
      if (key && value !== undefined) deps.repos.settings.set(key, value);
    }
    // FX-4: a conversão aprendida % → tokens por modelo vai para a interface (só leitura; PUT não a aceita)
    return c.json(resolveIngestSettings(deps.repos.settings));
  });

  return app;
}
