import { buildPersona, getCard, type Repos, renderRecruiterPrompt } from "@narnia-jobs/core";
import { Hono } from "hono";
import { apiError } from "../errors";
import { readRecruiterTemplate, stripFrontmatter } from "../plugin";

/**
 * Persona + cartão do perfil ativo para o hook `SessionStart` do modo B (F04-1), renderizados pelo mesmo template do
 * plugin que o modo A usa no system prompt (fonte única). `cardHash` permite ao chat detectar cartão atualizado.
 */
export function personaCardRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  app.get("/api/profiles/active/persona-card", (c) => {
    const profile = deps.repos.profiles.active();
    if (!profile)
      return apiError(c, 404, "no_profile", "Nenhum perfil ativo: conclua o primeiro uso.");
    const card = getCard(deps.repos, profile.id);
    const text = renderRecruiterPrompt(stripFrontmatter(readRecruiterTemplate()), {
      persona: buildPersona(profile),
      card: card.text,
      trustedDomains: deps.repos.trustedDomains.list(),
    });
    return c.json({ profileId: profile.id, cardHash: card.hash, text });
  });
  return app;
}
