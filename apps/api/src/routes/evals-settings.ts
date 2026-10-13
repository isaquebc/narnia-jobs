import {
  BRIDGE_SETTING_KEYS,
  bridgeKey,
  type Repos,
  resolveBridgeSettings,
  rotateBridgeKey,
} from "@narnia-jobs/core";
import {
  BridgeSettingsPutRequestSchema,
  type EvalsSettingsResponse,
  PhoenixAnthropicKeyRequestSchema,
} from "@narnia-jobs/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { apiError } from "../errors";
import { PHOENIX_BRIDGE_PROVIDER, type PhoenixAdmin } from "../evals/phoenix-admin";
import type { FullSync } from "../evals/phoenix-setup";
import { lastPromptSync, recordPromptSync } from "../evals/phoenix-setup";
import { promptCatalog } from "../evals/prompt-catalog";
import { validate } from "./validate";

/**
 * Configurações › Avaliações (decisão AV-2): a ponte da assinatura (liga/desliga, modelo padrão, concorrência, chave)
 * e o Phoenix (registrar a ponte como provedor, chave de API opcional da Anthropic). Sem Phoenix configurado, o estado
 * vem como não alcançável e as ações que falam com ele devolvem 409.
 */
export function evalsSettingsRoutes(deps: {
  repos: Repos;
  bridgeUrl: string;
  phoenixUrl: string | null;
  admin: PhoenixAdmin | null;
  /** Sincroniza os prompts do repositório (M2); null sem Phoenix. */
  syncPrompts?: (() => Promise<FullSync>) | null;
}) {
  const app = new Hono();
  const view = async (): Promise<EvalsSettingsResponse> => {
    const { providerId: _id, ...status } = deps.admin
      ? await deps.admin.status()
      : { reachable: false, providerRegistered: false, providerId: null, anthropicKeySet: false };
    return {
      bridge: {
        settings: resolveBridgeSettings(deps.repos.settings),
        key: bridgeKey(deps.repos.settings),
        url: deps.bridgeUrl,
      },
      phoenix: { url: deps.phoenixUrl, providerName: PHOENIX_BRIDGE_PROVIDER, ...status },
      prompts: { count: promptCatalog().length, lastSync: lastPromptSync(deps.repos) },
    };
  };
  const unavailable = (c: Context) =>
    apiError(
      c,
      409,
      "phoenix_unavailable",
      "O Phoenix não está no ar ou não está configurado (NARNIA_OTEL_ENDPOINT ou NARNIA_PHOENIX_URL).",
    );
  const phoenixError = (c: Context, e: unknown) =>
    apiError(c, 502, "phoenix_failed", `O Phoenix recusou: ${(e as Error).message}`);

  app.get("/api/settings/evals", async (c) => c.json(await view()));

  app.put(
    "/api/settings/evals/bridge",
    validate("json", BridgeSettingsPutRequestSchema),
    async (c) => {
      for (const [field, value] of Object.entries(c.req.valid("json"))) {
        if (value === undefined) continue;
        deps.repos.settings.set(
          BRIDGE_SETTING_KEYS[field as keyof typeof BRIDGE_SETTING_KEYS],
          value,
        );
      }
      return c.json(await view());
    },
  );

  app.post("/api/settings/evals/bridge/rotate-key", async (c) => {
    const key = rotateBridgeKey(deps.repos.settings);
    // provedor já registrado com a chave antiga: atualiza para o Playground não quebrar
    if (deps.admin && (await deps.admin.status()).providerRegistered)
      await deps.admin.registerBridge({ key, bridgeUrl: deps.bridgeUrl }).catch(() => undefined);
    return c.json(await view());
  });

  app.post("/api/settings/evals/phoenix/register", async (c) => {
    if (!deps.admin || !(await deps.admin.status()).reachable) return unavailable(c);
    try {
      await deps.admin.registerBridge({
        key: bridgeKey(deps.repos.settings),
        bridgeUrl: deps.bridgeUrl,
      });
    } catch (e) {
      return phoenixError(c, e);
    }
    return c.json(await view());
  });

  app.put(
    "/api/settings/evals/phoenix/anthropic-key",
    validate("json", PhoenixAnthropicKeyRequestSchema),
    async (c) => {
      if (!deps.admin || !(await deps.admin.status()).reachable) return unavailable(c);
      try {
        await deps.admin.setAnthropicKey(c.req.valid("json").apiKey);
      } catch (e) {
        return phoenixError(c, e);
      }
      return c.json(await view());
    },
  );
  app.post("/api/settings/evals/prompts/sync", async (c) => {
    if (!deps.admin || !deps.syncPrompts || !(await deps.admin.status()).reachable)
      return unavailable(c);
    try {
      recordPromptSync(deps.repos, await deps.syncPrompts());
    } catch (e) {
      recordPromptSync(deps.repos, e as Error);
      return phoenixError(c, e);
    }
    return c.json(await view());
  });
  return app;
}
