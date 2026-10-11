import type { Notification, NotificationKind } from "@narnia-jobs/shared";
import { NOTIFICATION_KINDS } from "@narnia-jobs/shared";
import { useState } from "react";
import { useTimezone } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs } from "../../components/ui/tabs";
import { type NotificationFilter, useNotifications } from "../../hooks/useNotifications";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";

const TONE = { info: "info", warning: "warn", error: "danger" } as const;

function NotificationItem({
  n,
  onRead,
  onDismiss,
}: {
  n: Notification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const tz = useTimezone();
  return (
    <li
      aria-label={n.title}
      className={`flex items-start justify-between gap-3 rounded-md border border-border p-3 ${n.readAt ? "opacity-75" : ""}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge tone={TONE[n.severity]}>{t(`notifications.severity.${n.severity}` as TKey)}</Badge>
          <span className="text-sm font-medium">{n.title}</span>
        </div>
        {n.body ? <p className="text-sm text-muted-fg">{n.body}</p> : null}
        <span className="text-xs text-muted-fg">{formatDate(n.createdAt, tz)}</span>
        {n.resolvedAt ? (
          <span className="text-xs text-ok">
            {t("notifications.resolvedAt", { date: formatDate(n.resolvedAt, tz) })}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {!n.resolvedAt ? (
          <NavLink
            to={n.actionUrl}
            onClick={() => {
              if (!n.readAt) onRead(n.id);
            }}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-fg hover:opacity-90"
          >
            {t("notifications.go")}
          </NavLink>
        ) : null}
        {!n.readAt && !n.resolvedAt ? (
          <Button size="sm" variant="outline" onClick={() => onRead(n.id)}>
            {t("notifications.markRead")}
          </Button>
        ) : null}
        {!n.resolvedAt ? (
          <Button size="sm" variant="ghost" onClick={() => onDismiss(n.id)}>
            {t("notifications.dismiss")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Página de pendências (F03-10): agrupada por tipo; abertas, resolvidas ou todas. */
export function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>("open");
  const { notifications, isLoading, markRead, dismiss } = useNotifications(filter);
  const groups = NOTIFICATION_KINDS.map(
    (kind) => [kind, notifications.filter((n) => n.kind === kind)] as const,
  ).filter(([, items]) => items.length > 0) as Array<readonly [NotificationKind, Notification[]]>;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("notifications.title")}</h1>
      <p className="text-sm text-muted-fg">{t("notifications.hint")}</p>
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as NotificationFilter)}
        items={[
          { value: "open", label: t("notifications.filter.open") },
          { value: "resolved", label: t("notifications.filter.resolved") },
          { value: "all", label: t("notifications.filter.all") },
        ]}
      >
        {isLoading ? <p className="text-sm text-muted-fg">{t("app.loading")}</p> : null}
        {!isLoading && notifications.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("notifications.empty")}</p>
        ) : null}
        <div className="flex flex-col gap-4">
          {groups.map(([kind, items]) => (
            <section key={kind} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">
                {t(`notifications.kinds.${kind.replaceAll(".", "_")}` as TKey)}
              </h2>
              <ul
                aria-label={t(`notifications.kinds.${kind.replaceAll(".", "_")}` as TKey)}
                className="flex flex-col gap-2"
              >
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    n={n}
                    onRead={(id) => markRead.mutate(id)}
                    onDismiss={(id) => dismiss.mutate(id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
