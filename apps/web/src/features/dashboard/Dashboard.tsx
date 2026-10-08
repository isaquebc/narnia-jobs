import { useQuery } from "@tanstack/react-query";
import { useApi, useTimezone } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Card, CardTitle } from "../../components/ui/card";
import { Tooltip } from "../../components/ui/tooltip";
import { t } from "../../i18n";
import { formatDate, formatTokens } from "../../lib/format";

const NEXT: Array<{ key: "chat" | "ingest" | "cv" | "jobs"; task: string }> = [
  { key: "chat", task: "F04" },
  { key: "ingest", task: "F03" },
  { key: "cv", task: "F05" },
  { key: "jobs", task: "F06" },
];

export function Dashboard() {
  const api = useApi();
  const tz = useTimezone();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard() });
  const user = useQuery({ queryKey: ["user"], queryFn: () => api.getUser() });
  if (dashboard.isError)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  if (!dashboard.data) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const d = dashboard.data;
  const name = user.data?.user?.displayName;
  // Sem cartão do perfil (chega em F02), a data mostrada é a última atualização do registro.
  const updatedAt =
    d.profile?.cardUpdatedAt ?? d.profile?.updatedAt ?? d.profile?.createdAt ?? null;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>
        {name ? <p className="text-sm text-muted-fg">{t("dashboard.welcome", { name })}</p> : null}
      </div>
      {!d.profile ? (
        <Alert>
          <p>{t("dashboard.empty")}</p>
          <NavLink to="/onboarding/1" className="underline">
            {t("dashboard.goOnboarding")}
          </NavLink>
        </Alert>
      ) : (
        <Card className="flex flex-col gap-2">
          <CardTitle>{t("dashboard.profileCard")}</CardTitle>
          <p className="text-lg font-medium">{d.profile.name}</p>
          <p className="text-sm">{d.profile.targetTitle}</p>
          <div className="flex gap-2 text-xs">
            <Badge tone="info">{t(`profile.seniorities.${d.profile.seniority}`)}</Badge>
            <Badge>{d.profile.area}</Badge>
            <Badge>{d.profile.market}</Badge>
          </div>
          {d.pendingResearch > 0 ? (
            <Alert tone="warn">{t("dashboard.research", { count: d.pendingResearch })}</Alert>
          ) : null}
          {updatedAt ? (
            <p className="text-xs text-muted-fg">
              {t("dashboard.updatedAt", { date: formatDate(updatedAt, tz) })}
            </p>
          ) : null}
        </Card>
      )}
      <div className="grid grid-cols-4 gap-4">
        {(["experiences", "skills", "education", "files"] as const).map((k) => (
          <Card key={k} className="flex flex-col gap-1">
            <span className="text-xs uppercase text-muted-fg">{t(`dashboard.stats.${k}`)}</span>
            <span className="text-2xl font-semibold">{d.counts[k]}</span>
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-2">
        <CardTitle>{t("dashboard.usage")}</CardTitle>
        <p className="text-sm">
          {t("dashboard.usageTokens", { tokens: formatTokens(d.usage.totalTokens) })}
        </p>
        {Object.keys(d.usage.byCategory).length > 0 ? (
          <p className="text-xs text-muted-fg">
            {t("dashboard.usageByCategory")}:{" "}
            {Object.entries(d.usage.byCategory)
              .map(([k, v]) => `${k} ${formatTokens(v)}`)
              .join(" · ")}
          </p>
        ) : null}
      </Card>
      <Card className="flex flex-col gap-2">
        <CardTitle>{t("dashboard.nextSteps")}</CardTitle>
        <ul className="flex flex-wrap gap-2">
          {NEXT.map((n) => (
            <li key={n.key}>
              <Tooltip content={t("nav.soon", { task: n.task })}>
                <span className="inline-block cursor-not-allowed rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-fg">
                  {t(`dashboard.next.${n.key}`)}
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
