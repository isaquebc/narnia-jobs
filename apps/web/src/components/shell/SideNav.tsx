import {
  Activity,
  Bell,
  Briefcase,
  Download,
  FolderGit2,
  LayoutDashboard,
  MessageSquare,
  Rocket,
  Settings,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useOnboardingState } from "../../hooks/useOnboarding";
import { useProfiles } from "../../hooks/useProfiles";
import { t } from "../../i18n";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/badge";
import { ChatNav, useLiveChats } from "./ChatNav";
import { NavLink } from "./NavLink";

const item =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted [&.active]:bg-muted [&.active]:font-medium";

function Group({ label, children }: { label: string; children: ReactNode }) {
  const id = `nav-group-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: grupo de navegação; fieldset é semântica de formulário
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <span
        id={id}
        className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-fg"
      >
        {label}
      </span>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

/**
 * Menu lateral em dois grupos (pedido do dono, 2026-10-11): o perfil ativo (o que tem viés de perfil, hoje o
 * Dashboard) e "Geral" (o que alimenta o usuário e não depende do perfil). Antes de concluir o primeiro uso, só ele
 * aparece; depois de concluído, ele some.
 */
export function SideNav({ className }: { className?: string }) {
  const onboarding = useOnboardingState();
  const { active } = useProfiles();
  const completed = onboarding.data?.completed === true;
  const live = useLiveChats(completed);
  return (
    <nav
      className={cn(
        "flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-card p-3",
        className,
      )}
      aria-label={t("app.name")}
    >
      {!onboarding.data ? null : !completed ? (
        <ul className="flex flex-col gap-1">
          <li>
            <NavLink to={`/onboarding/${onboarding.data.step || 1}`} className={item}>
              <Rocket size={16} /> {t("nav.onboarding")}
            </NavLink>
          </li>
        </ul>
      ) : (
        <>
          <Group label={active?.name ?? t("nav.currentProfile")}>
            <li>
              <NavLink to="/dashboard" className={item}>
                <LayoutDashboard size={16} /> {t("nav.dashboard")}
              </NavLink>
            </li>
          </Group>
          <hr className="border-border" />
          <Group label={t("nav.general")}>
            <li>
              <NavLink to="/chat" className={item}>
                <MessageSquare size={16} /> {t("nav.chat")}
                {live > 0 ? (
                  <Badge tone="ok" className="ml-auto">
                    <span aria-hidden>{live}</span>
                    <span className="sr-only">
                      {live === 1 ? t("nav.chatLiveOne") : t("nav.chatLive", { count: live })}
                    </span>
                  </Badge>
                ) : null}
              </NavLink>
              <ChatNav enabled={completed} />
            </li>
            <li>
              <NavLink to="/vagas" className={item}>
                <Briefcase size={16} /> {t("nav.postings")}
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
              <NavLink to="/evidencias/arquivos" className={item}>
                <FolderGit2 size={16} /> {t("nav.evidence")}
              </NavLink>
            </li>
            <li>
              <NavLink to="/pendencias" className={item}>
                <Bell size={16} /> {t("nav.notifications")}
              </NavLink>
            </li>
            <li>
              <NavLink to="/processos" className={item}>
                <Activity size={16} /> {t("nav.processes")}
              </NavLink>
            </li>
            <li>
              <NavLink to="/configuracoes" className={item}>
                <Settings size={16} /> {t("nav.settings")}
              </NavLink>
            </li>
          </Group>
        </>
      )}
    </nav>
  );
}
