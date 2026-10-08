import {
  buildAnalyzeInput,
  buildPersona,
  estimateAnalyze,
  getCard,
  isBelowReference,
  isCardValid,
  type ProfileRecord,
  type Repos,
  rebuildCard,
  refreshHeuristicSuggestions,
  resolveModel,
  suggestProfile,
  TERMINAL_JOB_STATUSES,
  taskJobId,
  trackInvalidation,
} from "@narnia-jobs/core";
import {
  AnalyzeRequestSchema,
  type EmphasisFactKind,
  type EmphasisListResponse,
  EmphasisPutRequestSchema,
  PersonaPutRequestSchema,
  type PersonaResponse,
  ProfileCloneRequestSchema,
  ProfileCreateRequestSchema,
  ProfilePatchRequestSchema,
  ProfilesListQuerySchema,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError, profileErrorResponse } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { validate } from "./validate";

export interface ProfilesRouteDeps {
  repos: Repos;
  bus: EventBus;
  queue: QueueAdapter;
}

export const ANALYZE_TASK_TYPE = "profile.analyze";

/** Emite `profile.card_invalidated` só com os perfis que estavam válidos e deixaram de estar (F02 §2.9-2). */
export function emitInvalidated(bus: EventBus, flipped: string[]): void {
  if (flipped.length > 0) bus.emit({ type: "profile.card_invalidated", profileIds: flipped });
}

type SalaryInput = {
  salary?:
    | { min: number; max: number; currency: string; period: "monthly" | "yearly" | "hourly" }
    | undefined;
  needsResearch: string[];
};

/** Regra F01-15: "não sei" no salário recebe o provisório DIEESE; o alerta só informa (`salaryBelowReference`). */
function resolveSalary(repos: Repos, body: SalaryInput) {
  const country = repos.users.get()?.country ?? "BR";
  const ref = repos.salaryReferences.current(country);
  let salary = body.salary;
  if (!salary && body.needsResearch.includes("salary") && ref) {
    salary = { min: ref.value, max: ref.value, currency: ref.currency, period: ref.period };
  }
  const salaryBelowReference = salary
    ? isBelowReference(salary.min, salary.currency, salary.period, ref) === true
    : false;
  return { salary, salaryBelowReference };
}

function cardResponse(repos: Repos, profile: ProfileRecord, card: ReturnType<typeof getCard>) {
  const fresh = repos.profiles.get(profile.id) ?? profile;
  return {
    ...card,
    profileId: profile.id,
    valid: isCardValid(fresh, repos.settings.getFactsVersion()),
  };
}

function personaResponse(profile: ProfileRecord): PersonaResponse {
  return {
    persona: buildPersona(profile),
    defaults: buildPersona({ ...profile, personaOverrides: {} }),
    overrides: profile.personaOverrides ?? {},
  };
}

const KIND_ORDER: EmphasisFactKind[] = ["experience", "project", "skill", "education", "language"];

/** Lista de ênfases com os fatos resolvidos (uma linha cada) e a relevância gravada na última reconstrução. */
function emphasisList(repos: Repos, profileId: string): EmphasisListResponse {
  const rows = new Map(
    repos.emphasis.list(profileId).map((e) => [`${e.factKind}:${e.factId}`, e] as const),
  );
  const relevance = new Map(
    repos.relevance
      .listByProfile(profileId)
      .map((r) => [`${r.factKind}:${r.factId}`, { score: r.score, reasons: r.reasons }] as const),
  );
  const f = repos.facts;
  const base: Array<{
    kind: EmphasisFactKind;
    id: string;
    label: string;
    sublabel: string | null;
    date: string | null;
  }> = [
    ...f.experiences.list().map((e) => ({
      kind: "experience" as const,
      id: e.id,
      label: e.title,
      sublabel: e.company,
      date: e.isCurrent ? (e.startDate ?? null) : (e.endDate ?? e.startDate ?? null),
    })),
    ...f.projects.list().map((p) => ({
      kind: "project" as const,
      id: p.id,
      label: p.name,
      sublabel: p.description ?? null,
      date: p.endDate ?? p.startDate ?? null,
    })),
    ...f.skills.list().map((s) => ({
      kind: "skill" as const,
      id: s.id,
      label: s.name,
      sublabel: s.category,
      date: null,
    })),
    ...f.education.list().map((e) => ({
      kind: "education" as const,
      id: e.id,
      label: e.course,
      sublabel: e.institution,
      date: e.endDate ?? e.startDate ?? null,
    })),
    ...f.languages.list().map((l) => ({
      kind: "language" as const,
      id: l.id,
      label: l.name,
      sublabel: l.level,
      date: null,
    })),
  ];
  const items = base.map((b) => {
    const row = rows.get(`${b.kind}:${b.id}`);
    return {
      ...b,
      mode: row?.mode ?? ("normal" as const),
      position: row?.position ?? null,
      relevance: relevance.get(`${b.kind}:${b.id}`) ?? null,
    };
  });
  items.sort((a, b) => {
    const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (k !== 0) return k;
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    if (a.date !== b.date) return (b.date ?? "").localeCompare(a.date ?? "");
    return a.label.localeCompare(b.label);
  });
  return { items };
}

/**
 * Perfis (F01 §3 + F02 §2.7): CRUD, clonar, arquivar, ativar, cartão, ênfases, persona, sugestões e análise.
 * Rotas literais (`suggestion`, `suggestions`, `analyze`) registradas antes de `/:id`.
 */
export function profilesRoutes(deps: ProfilesRouteDeps) {
  const app = new Hono();
  const { repos, bus } = deps;

  const requireProfile = (id: string) => {
    const p = repos.profiles.get(id);
    if (!p) return null;
    return p;
  };

  app.get("/api/profiles", validate("query", ProfilesListQuerySchema), (c) => {
    const { archived } = c.req.valid("query");
    return c.json({ profiles: repos.profiles.list({ includeArchived: archived }) });
  });

  app.post("/api/profiles", validate("json", ProfileCreateRequestSchema), (c) => {
    const { activate, suggestionId, ...body } = c.req.valid("json");
    const userId = repos.users.ensureId();
    const { salary, salaryBelowReference } = resolveSalary(repos, body);
    const others = repos.profiles.list({ includeArchived: true }).length;
    const profile = repos.profiles.create({
      ...body,
      ...(salary ? { salary } : {}),
      userId,
      salaryBelowReference,
      isActive: others === 0 || activate === true,
    });
    // sugestão de origem vira "aceita" (some do banner); id desconhecido não impede a criação
    if (suggestionId) {
      try {
        repos.suggestions.accept(suggestionId);
      } catch {
        /* sugestão já decidida ou inexistente */
      }
    }
    if (others > 0 && activate === true)
      bus.emit({ type: "profile.switched", profileId: profile.id });
    return c.json(profile, 201);
  });

  // ---- F01: sugestão do primeiro perfil (onboarding) ----
  app.get("/api/profiles/suggestion", (c) => {
    const runId = c.req.query("runId");
    let experiences = repos.facts.experiences.list().map((e) => ({
      title: e.title,
      startDate: e.startDate,
      ...(e.endDate ? { endDate: e.endDate } : {}),
      isCurrent: e.isCurrent,
      tech: e.tech,
    }));
    let skills: Array<{ name: string; category: string }> = repos.facts.skills
      .list()
      .map((s) => ({ name: s.name, category: s.category }));
    if (experiences.length === 0 && runId) {
      const proposals = repos.proposals.listByRun(runId);
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

  // ---- F02: sugestões (heurísticas + modelo) ----
  app.get("/api/profiles/suggestions", (c) => {
    refreshHeuristicSuggestions(repos);
    return c.json({ suggestions: repos.suggestions.list({ status: "new" }) });
  });

  app.post("/api/profiles/suggestions/:id/dismiss", (c) => {
    try {
      return c.json({ suggestion: repos.suggestions.dismiss(c.req.param("id")) });
    } catch (e) {
      return profileErrorResponse(c, e);
    }
  });

  // ---- F02: análise pelo modelo ----
  app.get("/api/profiles/analyze/estimate", (c) => {
    const model = resolveModel(repos.settings, "analyze", "sonnet");
    const input = buildAnalyzeInput(repos);
    const est = estimateAnalyze(input, model);
    return c.json({
      model: est.model,
      tokens: est.tokens,
      inputChars: JSON.stringify(input).length,
    });
  });

  app.post("/api/profiles/analyze", validate("json", AnalyzeRequestSchema), async (c) => {
    const { model } = c.req.valid("json");
    const key = repos.users.ensureId();
    const existing = repos.jobs.get(taskJobId(ANALYZE_TASK_TYPE, key));
    if (existing && !TERMINAL_JOB_STATUSES.has(existing.status)) {
      return apiError(c, 409, "analyze_pending", "Já há uma análise de perfis na fila", {
        jobId: existing.id,
      });
    }
    const { job } = await deps.queue.enqueueTask({
      queue: "extract",
      type: ANALYZE_TASK_TYPE,
      key,
      payload: model ? { model } : {},
      profileId: repos.profiles.active()?.id ?? null,
    });
    return c.json({ job }, 202);
  });

  // ---- F02: por id ----
  app.get("/api/profiles/:id", (c) => {
    const profile = requireProfile(c.req.param("id"));
    if (!profile) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    return c.json(profile);
  });

  app.patch("/api/profiles/:id", validate("json", ProfilePatchRequestSchema), (c) => {
    const id = c.req.param("id");
    if (!requireProfile(id)) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    const body = c.req.valid("json");
    try {
      const { result, flipped } = trackInvalidation(repos, () => {
        const patch: Record<string, unknown> = { ...body };
        if ("salary" in body || "needsResearch" in body) {
          const current = repos.profiles.get(id) as ProfileRecord;
          const merged = {
            salary: "salary" in body ? (body.salary ?? undefined) : current.salary,
            needsResearch: body.needsResearch ?? current.needsResearch,
          };
          const { salary, salaryBelowReference } = resolveSalary(repos, merged);
          patch.salary = salary;
          patch.salaryBelowReference = salaryBelowReference;
        }
        return repos.profiles.update(id, patch);
      });
      emitInvalidated(bus, flipped);
      return c.json(result);
    } catch (e) {
      if (e instanceof Error && e.name === "ZodError") {
        return apiError(
          c,
          400,
          "validation",
          "Dados inválidos",
          (e as { issues?: unknown }).issues,
        );
      }
      return profileErrorResponse(c, e);
    }
  });

  app.post("/api/profiles/:id/archive", (c) => {
    try {
      return c.json(repos.profiles.archive(c.req.param("id")));
    } catch (e) {
      return profileErrorResponse(c, e);
    }
  });

  app.post("/api/profiles/:id/unarchive", (c) => {
    try {
      return c.json(repos.profiles.unarchive(c.req.param("id")));
    } catch (e) {
      return profileErrorResponse(c, e);
    }
  });

  app.post("/api/profiles/:id/clone", validate("json", ProfileCloneRequestSchema), (c) => {
    const sourceId = c.req.param("id");
    if (!requireProfile(sourceId))
      return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    const {
      activate,
      suggestionId: _sg,
      pitch: _pitch,
      personaOverrides: _po,
      ...body
    } = c.req.valid("json");
    const { salary, salaryBelowReference } = resolveSalary(repos, body);
    try {
      const profile = repos.profiles.clone(sourceId, {
        ...body,
        ...(salary ? { salary } : {}),
        salaryBelowReference,
      });
      if (activate === true) {
        repos.profiles.setActive(profile.id);
        bus.emit({ type: "profile.switched", profileId: profile.id });
      }
      return c.json(repos.profiles.get(profile.id), 201);
    } catch (e) {
      return profileErrorResponse(c, e);
    }
  });

  app.put("/api/profiles/:id/activate", (c) => {
    const id = c.req.param("id");
    try {
      repos.profiles.setActive(id);
      bus.emit({ type: "profile.switched", profileId: id });
      return c.json(repos.profiles.get(id));
    } catch (e) {
      return profileErrorResponse(c, e);
    }
  });

  app.get("/api/profiles/:id/card", (c) => {
    const profile = requireProfile(c.req.param("id"));
    if (!profile) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    return c.json(cardResponse(repos, profile, getCard(repos, profile.id)));
  });

  app.post("/api/profiles/:id/card/rebuild", (c) => {
    const profile = requireProfile(c.req.param("id"));
    if (!profile) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    return c.json(cardResponse(repos, profile, rebuildCard(repos, profile.id)));
  });

  app.get("/api/profiles/:id/emphasis", (c) => {
    const profile = requireProfile(c.req.param("id"));
    if (!profile) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    return c.json(emphasisList(repos, profile.id));
  });

  app.put("/api/profiles/:id/emphasis", validate("json", EmphasisPutRequestSchema), (c) => {
    const profile = requireProfile(c.req.param("id"));
    if (!profile) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    const { items } = c.req.valid("json");
    try {
      const { result, flipped } = trackInvalidation(repos, () =>
        repos.emphasis.replace(profile.id, items),
      );
      emitInvalidated(bus, flipped);
      return c.json(result);
    } catch (e) {
      return profileErrorResponse(c, e);
    }
  });

  app.get("/api/profiles/:id/persona", (c) => {
    const profile = requireProfile(c.req.param("id"));
    if (!profile) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    return c.json(personaResponse(profile));
  });

  app.put("/api/profiles/:id/persona", validate("json", PersonaPutRequestSchema), (c) => {
    const profile = requireProfile(c.req.param("id"));
    if (!profile) return apiError(c, 404, "profile_not_found", "Perfil não encontrado");
    const overrides = c.req.valid("json");
    try {
      const { result, flipped } = trackInvalidation(repos, () =>
        repos.profiles.updatePersonaOverrides(profile.id, overrides),
      );
      emitInvalidated(bus, flipped);
      return c.json(personaResponse(result));
    } catch (e) {
      return profileErrorResponse(c, e);
    }
  });

  return app;
}
