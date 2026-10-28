import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { integrationsRoutes } from "../src/routes/integrations";

/** F07/M7 · status do Google Calendar (opcional): lido do `claude mcp list`, com cache, e o passo a passo de conexão. */
const app = (run: () => Promise<{ stdout: string } | { error: string }>) =>
  new Hono().route("/", integrationsRoutes({ runMcpList: run, oauthPort: 8189, cacheMs: 60_000 }));

describe("F07/M7 · GET /api/integrations/google-calendar/status", () => {
  it("conectado; a segunda leitura vem do cache", async () => {
    const run = vi.fn(async () => ({
      stdout: "google-calendar: https://calendarmcp.googleapis.com/mcp/v1 (HTTP) - ✓ Connected\n",
    }));
    const a = app(run);
    const body = (await (await a.request("/api/integrations/google-calendar/status")).json()) as {
      steps: { add: string };
    };
    expect(body).toMatchObject({
      status: "connected",
      redirectUri: "http://localhost:8189/callback",
      steps: { login: "claude mcp login google-calendar" },
    });
    expect(body.steps.add).toContain("--callback-port 8189");
    await a.request("/api/integrations/google-calendar/status");
    expect(run).toHaveBeenCalledTimes(1);
    await a.request("/api/integrations/google-calendar/status?refresh=1");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("CLI ausente: indisponível com o motivo", async () => {
    const body = await (
      await app(async () => ({ error: "CLI do Claude Code não encontrado" })).request(
        "/api/integrations/google-calendar/status",
      )
    ).json();
    expect(body).toMatchObject({
      status: "unavailable",
      detail: "CLI do Claude Code não encontrado",
    });
  });
});
