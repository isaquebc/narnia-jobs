import { execFile } from "node:child_process";
import {
  GOOGLE_CALENDAR_MCP_URL,
  type GoogleCalendarStatus,
  googleCalendarConnectSteps,
  parseGoogleCalendarStatus,
} from "@narnia-jobs/core";
import { resolveClaudeBinary } from "@narnia-jobs/providers";
import { Hono } from "hono";

export type McpListRunner = () => Promise<{ stdout: string } | { error: string }>;

/** `claude mcp list` no container do api (o mesmo `~/.claude` do recrutador do modo A). */
export const runClaudeMcpList: McpListRunner = () =>
  new Promise((resolve) => {
    const bin = resolveClaudeBinary({ explicit: process.env.NARNIA_CLAUDE_BIN });
    if (!bin) return resolve({ error: "CLI do Claude Code não encontrado" });
    execFile(bin, ["mcp", "list"], { timeout: 20_000 }, (err, stdout) =>
      err && !stdout ? resolve({ error: err.message }) : resolve({ stdout: String(stdout) }),
    );
  });

/**
 * Integrações (F07/M7, F07-4): o Google Calendar autenticado é opcional. O status lê o `claude mcp list` (com cache,
 * `?refresh=1` relê) e devolve o passo a passo com o cliente OAuth da própria pessoa; o segredo nunca passa pelo app.
 */
export function integrationsRoutes(deps: {
  runMcpList?: McpListRunner;
  oauthPort?: number;
  cacheMs?: number;
}) {
  const app = new Hono();
  const run = deps.runMcpList ?? runClaudeMcpList;
  const port = deps.oauthPort ?? 8089;
  let cached: { at: number; value: GoogleCalendarStatus } | null = null;

  app.get("/api/integrations/google-calendar/status", async (c) => {
    const fresh = c.req.query("refresh") === "1";
    if (!cached || fresh || Date.now() - cached.at > (deps.cacheMs ?? 60_000)) {
      const out = await run();
      cached = {
        at: Date.now(),
        value:
          "stdout" in out
            ? parseGoogleCalendarStatus(out.stdout)
            : parseGoogleCalendarStatus(null, out.error),
      };
    }
    const steps = googleCalendarConnectSteps({ clientId: "<SEU_CLIENT_ID>", callbackPort: port });
    return c.json({
      ...cached.value,
      mcpUrl: GOOGLE_CALENDAR_MCP_URL,
      callbackPort: port,
      redirectUri: steps.redirectUri,
      steps: { add: steps.add, login: steps.login },
    });
  });

  return app;
}
