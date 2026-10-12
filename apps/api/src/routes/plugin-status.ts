import type { Repos } from "@narnia-jobs/core";
import { Hono } from "hono";

/** Último sinal do modo B (auditoria E1): o hook `SessionStart` buscou o cartão ou o hook `Stop` registrou uso. */
export const PLUGIN_LAST_SEEN_KEY = "plugin.last_seen_at";

export interface PluginStatusDeps {
  repos: Repos;
  /** URL pela qual o Claude Code do computador chega a este api (`NARNIA_PUBLIC_URL`). */
  publicUrl: string;
  /** `initialize` + `tools/list` autenticados no `/mcp` desta instância (devolve o nº de tools). */
  mcpProbe: () => Promise<number>;
}

/**
 * Configurações › Modo plugin (F04 §4, auditoria E1): o que o app consegue saber de dentro do container. Se o plugin
 * está registrado no Claude Code do computador só o `./start.sh doctor` confere (roda no host); aqui vão o estado do
 * `/mcp`, a URL, o comando e a última vez que um Claude Code do terminal falou com esta instância.
 */
export function pluginStatusRoutes(deps: PluginStatusDeps) {
  const app = new Hono();
  app.get("/api/plugin/status", async (c) => {
    let mcp: { ok: boolean; tools: number };
    try {
      mcp = { ok: true, tools: await deps.mcpProbe() };
    } catch {
      mcp = { ok: false, tools: 0 };
    }
    const seen = deps.repos.settings.get(PLUGIN_LAST_SEEN_KEY);
    return c.json({
      mcpUrl: `${deps.publicUrl.replace(/\/$/, "")}/mcp`,
      mcp,
      command: "./start.sh install-plugin",
      doctorCommand: "./start.sh doctor",
      lastSeenAt: typeof seen === "string" ? seen : null,
    });
  });
  return app;
}
