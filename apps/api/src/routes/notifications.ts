import type { Repos } from "@narnia-jobs/core";
import { NotificationsListQuerySchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { validate } from "./validate";

/**
 * Pendências (F03-10): lista com a contagem de não resolvidas para o sino; ler e dispensar não resolvem (quem resolve
 * é o fluxo dono do assunto: revisão salva, decisão tomada).
 */
export function notificationsRoutes(deps: { repos: Repos; bus: EventBus }) {
  const app = new Hono();

  app.get("/api/notifications", validate("query", NotificationsListQuerySchema), (c) => {
    const { status } = c.req.valid("query");
    // FX-3: informativas com mais de 7 dias se resolvem sozinhas
    for (const n of deps.repos.notifications.expireInformational())
      deps.bus.emit({ type: "notification.updated", notification: n });
    return c.json({
      notifications: deps.repos.notifications.list({ status: status ?? "open" }),
      unresolved: deps.repos.notifications.countUnresolved(),
    });
  });

  for (const action of ["read", "dismiss"] as const) {
    app.post(`/api/notifications/:id/${action}`, (c) => {
      const id = c.req.param("id");
      if (!deps.repos.notifications.get(id))
        return apiError(c, 404, "not_found", "Notificação não encontrada");
      const n =
        action === "read"
          ? deps.repos.notifications.markRead(id)
          : deps.repos.notifications.dismiss(id);
      if (n) deps.bus.emit({ type: "notification.updated", notification: n });
      return c.json({ notification: n });
    });
  }

  return app;
}
