import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useApi } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { profileKey } from "../../hooks/useProfiles";
import { t } from "../../i18n";
import type { ProfileRecord } from "../../lib/api";

const TABS = ["enfases", "narrativa", "recrutador", "cartao"] as const;
export type ProfileTab = (typeof TABS)[number];

export function useProfile(id: string) {
  const api = useApi();
  return useQuery({ queryKey: profileKey(id), queryFn: () => api.getProfile(id) });
}

/** Layout de `/perfis/$id` (F02 §4): cabeçalho do perfil e abas; cada aba é uma rota filha. */
export function ProfilePage({
  id,
  children,
}: {
  id: string;
  children: (profile: ProfileRecord) => ReactNode;
}) {
  const profile = useProfile(id);
  if (profile.isError)
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const p = profile.data;
  const tabClass =
    "rounded-md px-3 py-1.5 text-sm hover:bg-muted [&.active]:bg-card [&.active]:shadow";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {p.name}
            {p.isActive ? <Badge tone="ok">{t("profiles.active")}</Badge> : null}
            {p.archivedAt ? <Badge tone="warn">{t("profiles.archived")}</Badge> : null}
          </h1>
          <p className="text-sm text-muted-fg">
            {p.targetTitle} · {t(`profile.seniorities.${p.seniority}`)} · {p.area} · {p.market}
          </p>
        </div>
        <NavLink to="/perfis" className="text-sm underline">
          {t("profiles.manage")}
        </NavLink>
      </div>
      <nav aria-label={t("profiles.title")} className="inline-flex rounded-md bg-muted p-1">
        {TABS.map((tab) => (
          <NavLink key={tab} to={`/perfis/$id/${tab}`} params={{ id }} className={tabClass}>
            {t(`profiles.tabs.${tab}`)}
          </NavLink>
        ))}
      </nav>
      {children(p)}
    </div>
  );
}
