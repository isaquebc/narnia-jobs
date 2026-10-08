import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { COOKIE_NAME, tokenMatches } from "./auth";
import type { EventBus } from "./events";

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** WebSocket `/ws`: autenticado por `?token=` ou cookie; retransmite os eventos do bus a todos os clientes. */
export function attachWebSocket(opts: { server: Server; bus: EventBus; token: string }) {
  const wss = new WebSocketServer({ noServer: true });
  opts.server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const given = url.searchParams.get("token") ?? cookieValue(req.headers.cookie, COOKIE_NAME);
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!tokenMatches(opts.token, given)) {
        ws.close(4401, "unauthorized");
        return;
      }
      wss.emit("connection", ws, req);
    });
  });
  opts.bus.on((event) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });
  return wss;
}
