import { LayoutDashboard, Rocket } from "lucide-react";
import { t } from "../../i18n";
import { cn } from "../../lib/cn";
import { NavLink } from "./NavLink";

const item =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted [&.active]:bg-muted [&.active]:font-medium";

/** Menu lateral mínimo (F01): Dashboard e Primeiro uso. Features futuras entram com suas tasks. */
export function SideNav({ className }: { className?: string }) {
  return (
    <nav
      className={cn("w-56 border-r border-border bg-card p-3", className)}
      aria-label={t("app.name")}
    >
      <ul className="flex flex-col gap-1">
        <li>
          <NavLink to="/dashboard" className={item}>
            <LayoutDashboard size={16} /> {t("nav.dashboard")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/onboarding/1" className={item}>
            <Rocket size={16} /> {t("nav.onboarding")}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
