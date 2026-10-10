import {
  isCardValid,
  parseCard,
  type Repos,
  rebuildCard,
  refreshHeuristicSuggestions,
} from "@narnia-jobs/core";
import type { DashboardResponse } from "@narnia-jobs/shared";
import { Hono } from "hono";
import type { EventBus } from "../events";
import { emitSuggestionNotifications } from "../services/runs";
import { usageSummary } from "./usage";

/** Resumo do cartão para o dashboard: cache com a validade atual; reconstrói só quando nunca houve cartão. */
function cardSummary(repos: Repos, profileId: string): DashboardResponse["card"] {
  const profile = repos.profiles.get(profileId);
  if (!profile) return null;
  let card = parseCard(profile);
  if (!card) card = rebuildCard(repos, profileId);
  const fresh = repos.profiles.get(profileId) ?? profile;
  return {
    text: card.text.split("\n").slice(0, 3).join("\n"),
    builtAt: card.builtAt,
    valid: isCardValid(fresh, repos.settings.getFactsVersion()),
  };
}

/** A heurística roda aqui também (barata): o banner do dashboard depende desta contagem antes de alguém abrir a lista. */
function countNewSuggestions(repos: Repos, bus?: EventBus): number {
  refreshHeuristicSuggestions(repos);
  if (bus) emitSuggestionNotifications(bus, repos);
  return repos.suggestions.list({ status: "new" }).length;
}

/** Dashboard (F01) estendido em F02 §2.7 com cartão, ênfases e sugestões do perfil ativo. */
export function dashboardRoutes(deps: { repos: Repos; bus?: EventBus }) {
  const app = new Hono();
  app.get("/api/dashboard", (c) => {
    const { repos } = deps;
    const profile = repos.profiles.active();
    const counts = repos.facts.counts();
    const usage = usageSummary(repos);
    const body: DashboardResponse = {
      profile,
      counts: {
        experiences: counts.experiences,
        skills: counts.skills,
        education: counts.education,
        files: repos.sourceFiles.list().length,
        projects: counts.projects,
      },
      usage: { totalTokens: usage.totalTokens, byCategory: usage.byCategory },
      pendingResearch: profile?.needsResearch.length ?? 0,
      card: profile ? cardSummary(repos, profile.id) : null,
      emphasis: profile ? repos.emphasis.countByMode(profile.id) : { highlighted: 0, hidden: 0 },
      suggestions: countNewSuggestions(repos, deps.bus),
    };
    return c.json(body);
  });
  return app;
}
