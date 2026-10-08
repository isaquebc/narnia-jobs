import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_NAMES,
  type Repos,
  resetDatabase,
  seedFixture,
  trackInvalidation,
} from "@narnia-jobs/core";
import { MockProvider, type Provider } from "@narnia-jobs/providers";
import { EmphasisFactKindSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { patchOnboarding } from "./onboarding";
import { emitInvalidated } from "./profiles";
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
      analyzeProfiles: z.string().optional(),
    })
    .optional(),
});

const SeedRequestSchema = z.object({ fixture: z.enum(FIXTURE_NAMES) });
/** Tipos de fato editáveis pelo endpoint de teste (E2E-04 do F02); `achievement` fica para F10. */
const TestFactKindSchema = EmphasisFactKindSchema.exclude(["achievement"]);
const FACT_REPO: Record<z.infer<typeof TestFactKindSchema>, keyof Repos["facts"]> = {
  experience: "experiences",
  project: "projects",
  skill: "skills",
  education: "education",
  language: "languages",
};

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
    // Semeadura dos cenários e2e do F02 (decisão F02-10): usuário + fatos + perfil ativo pelos repos, sem o wizard.
    app.post("/api/_test/seed", validate("json", SeedRequestSchema), (c) => {
      const ids = seedFixture(deps.repos, c.req.valid("json").fixture);
      patchOnboarding(deps.repos, { step: 5, completed: true });
      return c.json({ ok: true, ids });
    });
    // Altera um fato direto (E2E-04: invalidação dos cartões); a edição pela interface chega em F10.
    app.patch("/api/_test/facts/:kind/:id", async (c) => {
      const kind = TestFactKindSchema.safeParse(c.req.param("kind"));
      if (!kind.success) return apiError(c, 400, "unsupported_kind", "Tipo de fato inválido");
      const repo = deps.repos.facts[FACT_REPO[kind.data]] as {
        get(id: string): unknown;
        update(id: string, patch: Record<string, unknown>): unknown;
      };
      const id = c.req.param("id");
      if (!repo.get(id)) return apiError(c, 404, "fact_not_found", "Fato não encontrado");
      const patch = (await c.req.json()) as Record<string, unknown>;
      const { result, flipped } = trackInvalidation(deps.repos, () => repo.update(id, patch));
      emitInvalidated(deps.bus, flipped);
      return c.json(result);
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
    app.post("/api/_test/seed", (c) =>
      apiError(c, 404, "not_found", "Endpoint de teste indisponível"),
    );
    app.patch("/api/_test/facts/:kind/:id", (c) =>
      apiError(c, 404, "not_found", "Endpoint de teste indisponível"),
    );
  }
  return app;
}
