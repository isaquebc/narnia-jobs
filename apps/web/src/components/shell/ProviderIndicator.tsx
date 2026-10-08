import { useProviderStatus } from "../../hooks/useProviderStatus";
import { t } from "../../i18n";
import { cn } from "../../lib/cn";

export function providerLabel(s: { installed: boolean; loggedIn: boolean; authMethod: string }): {
  label: string;
  tone: "ok" | "warn" | "danger";
} {
  if (!s.installed) return { label: t("provider.notInstalled"), tone: "danger" };
  if (!s.loggedIn) return { label: t("provider.loggedOut"), tone: "warn" };
  if (s.authMethod === "claude.ai") return { label: t("provider.loggedInVolume"), tone: "ok" };
  if (s.authMethod === "oauth_token") return { label: t("provider.loggedInToken"), tone: "ok" };
  return { label: t("provider.loggedInOther", { method: s.authMethod }), tone: "ok" };
}

export function ProviderIndicator() {
  const { data, isLoading } = useProviderStatus();
  const state =
    isLoading || !data
      ? { label: t("provider.checking"), tone: "warn" as const }
      : providerLabel(data);
  const dot = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" }[state.tone];
  return (
    <div className="flex items-center gap-2 text-xs text-muted-fg" title={state.label}>
      <span className={cn("inline-block h-2 w-2 rounded-full", dot)} aria-hidden />
      <span>{t("provider.claudeCode")}</span>
      <span aria-hidden>·</span>
      <span className="max-w-64 truncate">{state.label}</span>
    </div>
  );
}
