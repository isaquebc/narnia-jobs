import { isDeviceToken, type Repos } from "@narnia-jobs/core";
import { ExtensionPairRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import { validate } from "./validate";

/** Tentativas erradas de pareamento aceitas por minuto, somadas (a rota é pública). */
const MAX_FAILURES_PER_MINUTE = 10;

/**
 * Extensão do navegador (F12/M1, F12-4, F12-9): Configurações gera o código de pareamento; a página de opções da
 * extensão o troca por um token de dispositivo (rota pública, com limite de tentativas) e testa a conexão em `/me`.
 */
export function extensionRoutes(deps: { repos: Repos; version: string }) {
  const app = new Hono();
  let failures: number[] = [];

  app.post("/api/extension/pairing", (c) => c.json(deps.repos.extension.createPairing()));

  app.post("/api/extension/pair", validate("json", ExtensionPairRequestSchema), (c) => {
    const now = Date.now();
    failures = failures.filter((at) => now - at < 60_000);
    if (failures.length >= MAX_FAILURES_PER_MINUTE)
      return apiError(c, 429, "too_many_attempts", "Muitas tentativas; espere um minuto.");
    const body = c.req.valid("json");
    const paired = deps.repos.extension.pair(body.code, body.name);
    if (!paired) {
      failures.push(now);
      return apiError(
        c,
        400,
        "invalid_code",
        "Código inválido ou vencido. Gere um novo em Configurações › Extensão do navegador.",
      );
    }
    return c.json(paired);
  });

  app.get("/api/extension/devices", (c) => c.json({ devices: deps.repos.extension.listDevices() }));

  app.delete("/api/extension/devices/:id", (c) =>
    deps.repos.extension.revoke(c.req.param("id"))
      ? c.body(null, 204)
      : apiError(c, 404, "not_found", "Dispositivo não encontrado"),
  );

  app.get("/api/extension/me", (c) => {
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const device = isDeviceToken(bearer) ? deps.repos.extension.findByToken(bearer) : null;
    return c.json({ device, version: deps.version });
  });

  return app;
}
