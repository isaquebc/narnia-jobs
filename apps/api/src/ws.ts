import type { Server } from "node:http";
import { isDeviceToken } from "@narnia-jobs/core";
import { WebSocketServer } from "ws";
import { COOKIE_NAME, type DeviceAuth, tokenMatches } from "./auth";
import type { EventBus } from "./events";
import { allowedHostsFromEnv, hostAllowed } from "./hosts";

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * WebSocket `/ws`: autenticado por `?token=` ou cookie (o do dono ou o token de dispositivo da janela da extensão,
 * F12/M2); retransmite os eventos do bus a todos os clientes.
 */
export function attachWebSocket(opts: {
  server: Server;
  bus: EventBus;
  token: string;
  devices?: DeviceAuth;
  /** Hosts aceitos (DNS rebinding); ausente = os do ambiente. */
  allowedHosts?: Set<string>;
}) {
  const wss = new WebSocketServer({ noServer: true });
  const allowed = opts.allowedHosts ?? allowedHostsFromEnv(process.env);
  opts.server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !hostAllowed(req.headers.host, allowed)) {
      socket.destroy();
      return;
    }
    const given = url.searchParams.get("token") ?? cookieValue(req.headers.cookie, COOKIE_NAME);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const device = given && isDeviceToken(given) ? opts.devices?.find(given) : null;
      if (device) opts.devices?.touch(device.id);
      if (!tokenMatches(opts.token, given) && !device) {
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
