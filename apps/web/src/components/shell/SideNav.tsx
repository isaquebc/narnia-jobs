import { Bell, Download, FolderGit2, LayoutDashboard, Rocket, Settings, Users } from "lucide-react";
import { t } from "../../i18n";
import { cn } from "../../lib/cn";
import { NavLink } from "./NavLink";

const item =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted [&.active]:bg-muted [&.active]:font-medium";

/** Menu lateral: Dashboard, Perfis (F02), Ingestão, Evidências, Pendências e Configurações (F03), Primeiro uso. */
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
          <NavLink to="/perfis" className={item}>
            <Users size={16} /> {t("nav.profiles")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/ingestao" className={item}>
            <Download size={16} /> {t("nav.ingestion")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/evidencias/repositorios" className={item}>
            <FolderGit2 size={16} /> {t("nav.evidence")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/pendencias" className={item}>
            <Bell size={16} /> {t("nav.notifications")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/configuracoes" className={item}>
            <Settings size={16} /> {t("nav.settings")}
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
