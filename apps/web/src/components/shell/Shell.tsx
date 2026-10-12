import type { ReactNode } from "react";
import { useTimezone } from "../../app/context";
import { useWsStatus } from "../../hooks/useWsStatus";
import { type TKey, t } from "../../i18n";
import { ActivityTray } from "./ActivityTray";
import { NotificationBell } from "./NotificationBell";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { ProviderIndicator } from "./ProviderIndicator";
import { SideNav } from "./SideNav";
import { ThemeToggle } from "./ThemeToggle";

export function Shell({ children }: { children: ReactNode }) {
  const tz = useTimezone();
  const wsStatus = useWsStatus();
  return (
    // altura da janela: cabeçalho, menu e rodapé ficam fixos e só o <main> rola (pedido do dono, 2026-10-12)
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-4">
          <span className="font-semibold">{t("app.name")}</span>
          <ProfileSwitcher />
        </div>
        <div className="flex items-center gap-3">
          <ProviderIndicator />
          <NotificationBell />
          <ActivityTray />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-border px-4 text-xs text-muted-fg">
        <span>{t("shell.timezone", { tz })}</span>
        <span>{t(`shell.connection.${wsStatus}` as TKey)}</span>
      </footer>
    </div>
  );
}
