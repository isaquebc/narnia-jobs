import type { Repos } from "@narnia-jobs/core";
import { Hono } from "hono";

export function usageSummary(repos: Repos) {
  const byCategory = Object.fromEntries(
    repos.usageEvents
      .summarizeByCategory()
      .map((r) => [r.category, r.inputTokens + r.outputTokens]),
  );
  return {
    totalTokens: repos.usageEvents.totalTokens(),
    byCategory,
    byModel: repos.usageEvents.summarizeByModel(),
  };
}

export function usageRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  app.get("/api/usage/summary", (c) => c.json(usageSummary(deps.repos)));
  return app;
}
