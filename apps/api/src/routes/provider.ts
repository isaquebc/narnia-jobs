import { rmSync } from "node:fs";
import { join } from "node:path";
import { type Repos, resetDatabase } from "@narnia-jobs/core";
import { MockProvider, type Provider } from "@narnia-jobs/providers";
import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { validate } from "./validate";

const MockModeSchema = z.object({
  installed: z.boolean().optional(),
  loggedIn: z.boolean().optional(),
  authMethod: z
    .enum(["claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"])
    .optional(),
  version: z.string().optional(),
  delayMs: z.number().int().min(0).max(120_000).optional(),
  errors: z
    .object({
      detect: z.string().optional(),
      readDocument: z.string().optional(),
      extractFacts: z.string().optional(),
      buildDigest: z.string().optional(),
    })
    .optional(),
});

/** Pastas derivadas dos uploads que o reset apaga (os dados do usuário em si estão no SQLite). */
const RESET_DIRS = ["uploads", "readings", "digests"];

export function providerRoutes(deps: {
  provider: Provider;
  bus: EventBus;
  repos: Repos;
  dataDir: string;
}) {
  const app = new Hono();
  app.get("/api/provider/status", async (c) => c.json(await deps.provider.detect()));

  // Endpoints de teste: só existem quando o provider é o mock (NARNIA_PROVIDER=mock). Usados pelo e2e e em dev.
  if (deps.provider instanceof MockProvider) {
    const mock = deps.provider;
    // Isolamento entre cenários e2e (M7): apaga dados e arquivos, zera o wizard e devolve o mock aos padrões.
    app.post("/api/_test/reset", async (c) => {
      const { tables } = resetDatabase(deps.repos.db);
      for (const dir of RESET_DIRS)
        rmSync(join(deps.dataDir, dir), { recursive: true, force: true });
      mock.reset();
      deps.bus.emit({ type: "provider.status", status: await mock.detect() });
      return c.json({ ok: true, tables });
    });
    app.post("/api/_test/mock", validate("json", MockModeSchema), async (c) => {
      const body = c.req.valid("json");
      mock.setMode(
        Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Parameters<
          typeof mock.setMode
        >[0],
      );
      const status = await mock.detect();
      deps.bus.emit({ type: "provider.status", status });
      return c.json({ mode: mock.getMode(), status });
    });
  } else {
    app.post("/api/_test/mock", (c) =>
      apiError(c, 404, "not_found", "Endpoint de teste indisponível"),
    );
    app.post("/api/_test/reset", (c) =>
      apiError(c, 404, "not_found", "Endpoint de teste indisponível"),
    );
  }
  return app;
}
