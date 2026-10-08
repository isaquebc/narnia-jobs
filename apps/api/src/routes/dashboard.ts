import type { Repos } from "@narnia-jobs/core";
import { Hono } from "hono";
import { usageSummary } from "./usage";

export function dashboardRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  app.get("/api/dashboard", (c) => {
    const profile = deps.repos.profiles.active();
    const counts = deps.repos.facts.counts();
    const usage = usageSummary(deps.repos);
    return c.json({
      profile,
      counts: {
        experiences: counts.experiences,
        skills: counts.skills,
        education: counts.education,
        files: deps.repos.sourceFiles.list().length,
      },
      usage: { totalTokens: usage.totalTokens, byCategory: usage.byCategory },
      pendingResearch: profile?.needsResearch.length ?? 0,
    });
  });
  return app;
}
