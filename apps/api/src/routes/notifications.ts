import type { Repos } from "@narnia-jobs/core";
import { NATIVE_NOTIFICATION_KINDS, NotificationsListQuerySchema } from "@narnia-jobs/shared";
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
      // contador do sino (CM-3): só as abertas que o dono ainda não viu
      unresolved: deps.repos.notifications.countUnseen(),
    });
  });

  // F15-3 · vigia do sistema (scripts/notify): avisos novos depois do cursor, só dos tipos que viram notificação nativa.
  // Sem cursor (primeira vez), devolve só o cursor atual: o vigia não despeja o histórico na tela.
  app.get("/api/notifications/native", (c) => {
    const after = c.req.query("after");
    if (!after || Number.isNaN(Date.parse(after))) {
      const now = new Date().toISOString();
      return c.req.query("format") === "text"
        ? c.text(`${now}\n`)
        : c.json({ cursor: now, items: [] });
    }
    const items = deps.repos.notifications.createdAfter(after, NATIVE_NOTIFICATION_KINDS, 20);
    const cursor = items.at(-1)?.createdAt ?? after;
    // `format=text` (o vigia em bash, sem jq nem python): 1ª linha o cursor, depois título, corpo, link e urgente
    // separados por tabulação, sem tabulação nem quebra de linha dentro dos campos
    if (c.req.query("format") === "text") {
      const flat = (s: string | null) => (s ?? "").replace(/[\t\r\n]+/g, " ").trim();
      return c.text(
        [
          cursor,
          ...items.map((n) =>
            [flat(n.title), flat(n.body), n.actionUrl, n.severity !== "info"].join("\t"),
          ),
        ].join("\n") + "\n",
      );
    }
    return c.json({
      cursor,
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        url: n.actionUrl,
        urgent: n.severity !== "info",
      })),
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
