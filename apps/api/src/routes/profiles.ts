import { isBelowReference, type Repos, suggestProfile } from "@narnia-jobs/core";
import { ProfileCreateRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { validate } from "./validate";

/** Perfil (F01 §3 / F01-15): carreira obrigatória, "não sei" → provisório + needsResearch; piso DIEESE só informa. */
export function profilesRoutes(deps: { repos: Repos }) {
  const app = new Hono();

  app.get("/api/profiles", (c) => c.json({ profiles: deps.repos.profiles.list() }));

  app.post("/api/profiles", validate("json", ProfileCreateRequestSchema), (c) => {
    const body = c.req.valid("json");
    const userId = deps.repos.users.ensureId();
    const country = deps.repos.users.get()?.country ?? "BR";
    const ref = deps.repos.salaryReferences.current(country);
    let salary = body.salary;
    if (!salary && body.needsResearch.includes("salary") && ref) {
      salary = { min: ref.value, max: ref.value, currency: ref.currency, period: ref.period };
    }
    const salaryBelowReference = salary
      ? isBelowReference(salary.min, salary.currency, salary.period, ref) === true
      : false;
    const profile = deps.repos.profiles.create({
      ...body,
      ...(salary ? { salary } : {}),
      userId,
      salaryBelowReference,
      isActive: deps.repos.profiles.list().length === 0,
    });
    return c.json(profile, 201);
  });

  app.get("/api/profiles/suggestion", (c) => {
    const runId = c.req.query("runId");
    let experiences = deps.repos.facts.experiences.list().map((e) => ({
      title: e.title,
      startDate: e.startDate,
      ...(e.endDate ? { endDate: e.endDate } : {}),
      isCurrent: e.isCurrent,
      tech: e.tech,
    }));
    let skills: Array<{ name: string; category: string }> = deps.repos.facts.skills
      .list()
      .map((s) => ({ name: s.name, category: s.category }));
    if (experiences.length === 0 && runId) {
      const proposals = deps.repos.proposals.listByRun(runId);
      experiences = proposals
        .filter((p) => p.kind === "experience")
        .map(
          (p) =>
            p.proposal.data as {
              title: string;
              startDate: string;
              endDate?: string;
              isCurrent: boolean;
              tech: string[];
            },
        )
        .map((d) => ({
          title: d.title,
          startDate: d.startDate,
          ...(d.endDate ? { endDate: d.endDate } : {}),
          isCurrent: d.isCurrent,
          tech: d.tech ?? [],
        }));
      skills = proposals
        .filter((p) => p.kind === "skill")
        .map((p) => p.proposal.data as { name: string; category: string });
    }
    if (experiences.length === 0 && skills.length === 0) {
      return c.json({ targetTitle: null, seniority: null, area: null, altTitles: [], reasons: [] });
    }
    const s = suggestProfile({ experiences, skills });
    return c.json({
      targetTitle: s.targetTitle,
      seniority: s.seniority,
      area: s.area,
      altTitles: s.altTitles,
      yearsOfExperience: s.yearsOfExperience,
      reasons: [s.reason],
    });
  });

  return app;
}
