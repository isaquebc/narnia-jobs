import { describe, expect, it } from "vitest";
import {
  GOOGLE_CALENDAR_MCP_URL,
  googleCalendarConnectSteps,
  parseGoogleCalendarStatus,
} from "../../src/job-applications/google-calendar";

/**
 * F07/M7 · Google Calendar opcional (F07-4): o status vem do `claude mcp list` do container (servidor `google-calendar`
 * registrado e autenticado); o passo a passo de conexão usa o cliente OAuth da própria pessoa.
 */
describe("F07/M7 · status do Google Calendar", () => {
  it("conectado, precisa de login, não configurado", () => {
    const list = (line: string) =>
      `Checking MCP server health...\n\nnarnia-jobs: http://api:3100/mcp (HTTP) - ✓ Connected\n${line}\n`;
    expect(
      parseGoogleCalendarStatus(
        list(`google-calendar: ${GOOGLE_CALENDAR_MCP_URL} (HTTP) - ✓ Connected`),
      ),
    ).toEqual({ status: "connected", detail: null });
    expect(
      parseGoogleCalendarStatus(
        list(`google-calendar: ${GOOGLE_CALENDAR_MCP_URL} (HTTP) - ⚠ Needs authentication`),
      ).status,
    ).toBe("needs_auth");
    expect(
      parseGoogleCalendarStatus(
        list(`google-calendar: ${GOOGLE_CALENDAR_MCP_URL} (HTTP) - ✗ Failed to connect`),
      ),
    ).toEqual({ status: "error", detail: "✗ Failed to connect" });
    expect(parseGoogleCalendarStatus(list("")).status).toBe("not_configured");
  });

  it("sem o CLI ou com erro: indisponível, com o motivo", () => {
    expect(parseGoogleCalendarStatus(null, "CLI do Claude Code não encontrado")).toEqual({
      status: "unavailable",
      detail: "CLI do Claude Code não encontrado",
    });
  });

  it("passo a passo com o client ID, a porta do callback e o login", () => {
    const steps = googleCalendarConnectSteps({
      clientId: "123.apps.googleusercontent.com",
      callbackPort: 8089,
    });
    expect(steps.add).toBe(
      `claude mcp add --transport http google-calendar ${GOOGLE_CALENDAR_MCP_URL} --client-id 123.apps.googleusercontent.com --client-secret --callback-port 8089 --scope user`,
    );
    expect(steps.login).toBe("claude mcp login google-calendar");
    expect(steps.redirectUri).toBe("http://localhost:8089/callback");
  });
});
