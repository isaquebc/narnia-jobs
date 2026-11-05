import { Hono } from "hono";
import { z } from "zod";
import type { SemanticSearchService } from "../services/semantic-search";
import { validate } from "./validate";

/** Configurações › Busca por sentido (R6, FF-5, FF-7): estado, alerta do limite do índice e ligar/desligar. */
export function semanticSearchRoutes(deps: { semantic: SemanticSearchService }) {
  const app = new Hono();
  app.get("/api/settings/semantic-search", (c) => c.json(deps.semantic.view()));
  app.put(
    "/api/settings/semantic-search",
    validate("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      await deps.semantic.setEnabled(c.req.valid("json").enabled);
      return c.json(deps.semantic.view());
    },
  );
  return app;
}
