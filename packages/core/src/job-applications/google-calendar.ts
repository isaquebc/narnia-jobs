/**
 * Google Calendar autenticado, opcional (F07-4, `../08-docker-calendar-voz.md §2`): o servidor MCP oficial do Google
 * registrado no Claude Code do container com o cliente OAuth da própria pessoa. O app só lê o estado (`claude mcp
 * list`); quem cria e consulta eventos é o recrutador, pelas tools do Google, quando está conectado. Sem conexão, a
 * agenda segue com o link do modelo e o `.ics`.
 */
export const GOOGLE_CALENDAR_MCP_NAME = "google-calendar";
export const GOOGLE_CALENDAR_MCP_URL = "https://calendarmcp.googleapis.com/mcp/v1";

export type GoogleCalendarState =
  | "connected"
  | "needs_auth"
  | "not_configured"
  | "error"
  | "unavailable";

export interface GoogleCalendarStatus {
  status: GoogleCalendarState;
  detail: string | null;
}

/** Lê a saída do `claude mcp list` (null = o comando não rodou; `error` diz por quê). */
export function parseGoogleCalendarStatus(
  output: string | null,
  error?: string,
): GoogleCalendarStatus {
  if (output === null) return { status: "unavailable", detail: error ?? null };
  const line = output
    .split(/\r?\n/)
    .find((l) => l.trimStart().startsWith(`${GOOGLE_CALENDAR_MCP_NAME}:`));
  if (!line) return { status: "not_configured", detail: null };
  const state = line.split(" - ").pop()?.trim() ?? "";
  if (/connected/i.test(state) && !/fail|not/i.test(state))
    return { status: "connected", detail: null };
  if (/auth/i.test(state)) return { status: "needs_auth", detail: state };
  return { status: "error", detail: state || null };
}

/** Comandos para conectar (rodam dentro do container do api; o segredo é pedido pelo próprio CLI, nunca vai por argumento). */
export function googleCalendarConnectSteps(o: { clientId: string; callbackPort: number }) {
  return {
    redirectUri: `http://localhost:${o.callbackPort}/callback`,
    add: `claude mcp add --transport http ${GOOGLE_CALENDAR_MCP_NAME} ${GOOGLE_CALENDAR_MCP_URL} --client-id ${o.clientId} --client-secret --callback-port ${o.callbackPort} --scope user`,
    login: `claude mcp login ${GOOGLE_CALENDAR_MCP_NAME}`,
  };
}
