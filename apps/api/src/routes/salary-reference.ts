import type { Repos } from "@narnia-jobs/core";
import { Hono } from "hono";

/** Referência salarial corrente (DIEESE) para a UI mostrar o alerta informativo antes de salvar (F01-15). */
export function salaryReferenceRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  app.get("/api/salary-reference", (c) => {
    const country = (
      c.req.query("country") ??
      deps.repos.users.get()?.country ??
      "BR"
    ).toUpperCase();
    return c.json({ reference: deps.repos.salaryReferences.current(country) });
  });
  return app;
}
