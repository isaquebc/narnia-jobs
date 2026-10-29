import {
  CHAT_SETTING_KEYS,
  listFactAliases,
  type Repos,
  resolveChatSettings,
  TrustedDomainError,
} from "@narnia-jobs/core";
import {
  ChatSettingsPutRequestSchema,
  TrustedDomainCreateRequestSchema,
  TrustedDomainPatchRequestSchema,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import { validate } from "./validate";

const DOMAIN_STATUS = { builtin_domain: 409, domain_exists: 409, domain_not_found: 404 } as const;

/** Configurações › Chat (F04 M4): preferências do chat e lista de domínios confiáveis para pesquisa (F04-5). */
export function chatSettingsRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  const view = () => ({ settings: resolveChatSettings(deps.repos.settings) });
  const domains = () => ({ domains: deps.repos.trustedDomains.list() });
  const domainError = (c: Parameters<typeof apiError>[0], e: unknown) => {
    if (e instanceof TrustedDomainError)
      return apiError(c, DOMAIN_STATUS[e.code], e.code, e.message);
    throw e;
  };

  app.get("/api/settings/chat", (c) => c.json(view()));
  app.put("/api/settings/chat", validate("json", ChatSettingsPutRequestSchema), (c) => {
    const body = c.req.valid("json");
    for (const [field, value] of Object.entries(body)) {
      if (value === undefined) continue;
      deps.repos.settings.set(CHAT_SETTING_KEYS[field as keyof typeof CHAT_SETTING_KEYS], value);
    }
    return c.json(view());
  });

  // termos aprendidos pela busca de fatos (F04-fix-fundamentacao, FF-1): a pessoa vê e apaga
  app.get("/api/settings/fact-aliases", (c) => c.json({ aliases: listFactAliases(deps.repos) }));
  app.delete("/api/settings/fact-aliases/:id", (c) =>
    deps.repos.factAliases.remove(c.req.param("id"))
      ? c.body(null, 204)
      : apiError(c, 404, "not_found", "Termo não encontrado"),
  );

  app.get("/api/settings/trusted-domains", (c) => c.json(domains()));
  app.post("/api/settings/trusted-domains/restore", (c) => {
    deps.repos.trustedDomains.restoreDefaults();
    return c.json(domains());
  });
  app.post(
    "/api/settings/trusted-domains",
    validate("json", TrustedDomainCreateRequestSchema),
    (c) => {
      try {
        return c.json({ domain: deps.repos.trustedDomains.add(c.req.valid("json")) }, 201);
      } catch (e) {
        return domainError(c, e);
      }
    },
  );
  app.patch(
    "/api/settings/trusted-domains/:id",
    validate("json", TrustedDomainPatchRequestSchema),
    (c) => {
      const id = c.req.param("id");
      if (!deps.repos.trustedDomains.list().some((d) => d.id === id))
        return apiError(c, 404, "domain_not_found", "Domínio não encontrado");
      deps.repos.trustedDomains.setEnabled(id, c.req.valid("json").enabled);
      return c.json(domains());
    },
  );
  app.delete("/api/settings/trusted-domains/:id", (c) => {
    try {
      deps.repos.trustedDomains.remove(c.req.param("id"));
      return c.body(null, 204);
    } catch (e) {
      return domainError(c, e);
    }
  });
  return app;
}
