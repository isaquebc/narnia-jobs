import { Bell } from "lucide-react";
import { useNotifications } from "../../hooks/useNotifications";
import { t } from "../../i18n";
import { NavLink } from "./NavLink";

/** Sino do cabeçalho (F03-10): contagem de pendências não resolvidas; leva à página de pendências. */
export function NotificationBell() {
  const { unresolved } = useNotifications();
  const label =
    unresolved > 0 ? t("notifications.bellCount", { count: unresolved }) : t("notifications.bell");
  return (
    <NavLink
      to="/pendencias"
      ariaLabel={label}
      className="relative inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-muted"
    >
      <Bell size={16} />
      {unresolved > 0 ? (
        <span
          data-testid="notifications-count"
          className="rounded-full bg-warn px-1.5 text-xs font-semibold text-white"
        >
          {unresolved}
        </span>
      ) : null}
    </NavLink>
  );
}
