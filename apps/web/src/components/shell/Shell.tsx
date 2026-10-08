import type { ReactNode } from "react";
import { useTimezone } from "../../app/context";
import { useProfiles } from "../../hooks/useProfiles";
import { useWsStatus } from "../../hooks/useWsStatus";
import { type TKey, t } from "../../i18n";
import { ActivityTray } from "./ActivityTray";
import { ProviderIndicator } from "./ProviderIndicator";
import { SideNav } from "./SideNav";
import { ThemeToggle } from "./ThemeToggle";

export function Shell({ children }: { children: ReactNode }) {
  const { active } = useProfiles();
  const tz = useTimezone();
  const wsStatus = useWsStatus();
  return (
    <div className="flex h-full min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-4">
          <span className="font-semibold">{t("app.name")}</span>
          <span className="rounded-md bg-muted px-2 py-1 text-sm" title={t("shell.activeProfile")}>
            {active ? active.name : t("shell.noProfile")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ProviderIndicator />
          <ActivityTray />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-1">
        <SideNav />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <footer className="flex h-8 items-center justify-between border-t border-border px-4 text-xs text-muted-fg">
        <span>{t("shell.timezone", { tz })}</span>
        <span>{t(`shell.connection.${wsStatus}` as TKey)}</span>
      </footer>
    </div>
  );
}
