import { buildPersona, getCard, type Repos, renderRecruiterPrompt } from "@narnia-jobs/core";
import { nowUtc } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import { readPluginFile, readRecruiterTemplate, splitFrontmatter } from "../plugin";
import { PLUGIN_LAST_SEEN_KEY } from "./plugin-status";

/** Nome do servidor MCP no Claude Code do usuário (vira `mcp__<nome>__*` no frontmatter do agente). */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Persona + cartão do perfil ativo para o modo B (F04-1), renderizados pelo mesmo template do plugin que o modo A usa
 * no system prompt (fonte única). Três formatos:
 * - JSON (padrão): `{ profileId, cardHash, text }`; `cardHash` permite ao chat detectar cartão atualizado;
 * - `?format=text`: o texto puro, com o hash no header `X-Narnia-Card-Hash` (o hook `SessionStart` lê sem jq/node);
 * - `?format=agent&server=<nome>`: o arquivo do agente `recrutador` para o plugin instalado (auditoria C): frontmatter
 *   com as tools do servidor registrado e corpo sem placeholder; o cartão fica de fora (envelheceria no arquivo) e o
 *   agente o busca por `profile_get_card`.
 */
export function personaCardRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  app.get("/api/profiles/active/persona-card", (c) => {
    const format = c.req.query("format") ?? "json";
    const server = c.req.query("server") ?? "";
    if (format === "agent" && !SERVER_NAME.test(server))
      return apiError(c, 400, "invalid_server", "Nome do servidor MCP inválido.");
    const profile = deps.repos.profiles.active();
    if (!profile)
      return apiError(c, 404, "no_profile", "Nenhum perfil ativo: conclua o primeiro uso.");
    const card = getCard(deps.repos, profile.id);
    const { frontmatter, body } = splitFrontmatter(readRecruiterTemplate());
    const render = (cardText: string) =>
      renderRecruiterPrompt(body, {
        persona: buildPersona(profile),
        card: cardText,
        trustedDomains: deps.repos.trustedDomains.list(),
      });
    if (format === "agent") {
      const head = frontmatter.replace(/mcp__narnia-jobs__\*/g, `mcp__${server}__*`);
      c.header("content-type", "text/markdown; charset=utf-8");
      return c.body(`${head}\n${render(readPluginFile("prompts/cartao-via-tool.md").trim())}`);
    }
    const text = render(card.text);
    if (format === "text") {
      // só o hook SessionStart do terminal pede o texto: sinal de plugin em uso (Configurações › Modo plugin)
      deps.repos.settings.set(PLUGIN_LAST_SEEN_KEY, nowUtc());
      c.header("x-narnia-card-hash", card.hash);
      return c.text(text);
    }
    return c.json({ profileId: profile.id, cardHash: card.hash, text });
  });
  return app;
}
