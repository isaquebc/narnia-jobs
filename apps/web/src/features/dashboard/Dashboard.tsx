import type { DashboardResponse } from "@narnia-jobs/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useTimezone } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Card, CardTitle } from "../../components/ui/card";
import { Tooltip } from "../../components/ui/tooltip";
import { t } from "../../i18n";
import { formatDate, formatTokens } from "../../lib/format";
import { CardText } from "../profiles/CardText";
import { SuggestionBanner } from "../profiles/SuggestionBanner";

const NEXT: Array<{ key: "chat" | "ingest" | "cv" | "jobs"; task: string; to?: string }> = [
  { key: "chat", task: "F04" },
  { key: "ingest", task: "F03" },
  { key: "cv", task: "F05" },
  // F06 entregue: a análise de vagas vira link
  { key: "jobs", task: "F06", to: "/vagas" },
];

export function Dashboard() {
  const api = useApi();
  const tz = useTimezone();
  const qc = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard() });
  const user = useQuery({ queryKey: ["user"], queryFn: () => api.getUser() });
  // O GET do dashboard sincroniza a notificação das sugestões de perfil; o evento do WS pode chegar antes de a conexão
  // abrir e se perder (CI 2026-11-06, F03/E2E-12), então o sino relê as pendências a cada carga do dashboard.
  const loadedAt = dashboard.dataUpdatedAt;
  useEffect(() => {
    if (loadedAt) void qc.invalidateQueries({ queryKey: ["notifications"] });
  }, [loadedAt, qc]);
  if (dashboard.isError)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  if (!dashboard.data) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const d = dashboard.data;
  const name = user.data?.user?.displayName;
  // Data do cartão quando existe (F02); senão a última atualização do registro.
  const updatedAt =
    d.card?.builtAt ??
    d.profile?.cardUpdatedAt ??
    d.profile?.updatedAt ??
    d.profile?.createdAt ??
    null;
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
          {d.card ? (
            <div className="flex flex-col gap-1 rounded-md border border-border p-2">
              <CardText text={d.card.text} lines={3} />
              <div className="flex items-center gap-3 text-xs">
                {!d.card.valid ? <Badge tone="warn">{t("profiles.cardStale")}</Badge> : null}
                <NavLink
                  to="/perfis/$id/cartao"
                  params={{ id: d.profile.id }}
                  className="underline"
                >
                  {t("card.viewAll")}
                </NavLink>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-fg">
            <span>
              {t("dashboard.emphasis", {
                highlighted: d.emphasis.highlighted,
                hidden: d.emphasis.hidden,
              })}
            </span>
            {" · "}
            <NavLink to="/perfis" className="underline">
              {t("dashboard.manageProfiles")}
            </NavLink>
          </p>
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
      <SuggestionBanner count={d.suggestions} />
      <div className="grid grid-cols-5 gap-4">
        {(["experiences", "projects", "skills", "education", "files"] as const).map((k) => (
          <Card key={k} data-testid={`stat-${k}`} className="flex flex-col gap-1">
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
        {d.usage.categories?.length ? (
          <UsageTable categories={d.usage.categories} totalCostUsd={d.usage.totalCostUsd ?? 0} />
        ) : Object.keys(d.usage.byCategory).length > 0 ? (
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
              {n.to ? (
                <NavLink
                  to={n.to}
                  className="inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {t(`dashboard.next.${n.key}`)}
                </NavLink>
              ) : (
                <Tooltip content={t("nav.soon", { task: n.task })}>
                  <span className="inline-block cursor-not-allowed rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-fg">
                    {t(`dashboard.next.${n.key}`)}
                  </span>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const usd = (n: number) =>
  `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Uso por categoria (redução de custo, 2026-10-26): da mais cara para a mais barata, com as chamadas, os tokens novos
 * (entrada + saída), o cache lido e o custo estimado. Os subagentes da conversa não têm custo próprio: o do SDK vem
 * somado na conversa.
 */
function UsageTable({
  categories,
  totalCostUsd,
}: {
  categories: NonNullable<DashboardResponse["usage"]["categories"]>;
  totalCostUsd: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-fg">
        {t("dashboard.usageTotalCost", { cost: usd(totalCostUsd) })}
      </p>
      <table aria-label={t("dashboard.usageTable")} className="w-full text-left text-xs">
        <thead className="text-muted-fg">
          <tr>
            <th className="py-1 font-medium">{t("dashboard.usageCols.category")}</th>
            <th className="py-1 font-medium">{t("dashboard.usageCols.events")}</th>
            <th className="py-1 font-medium">{t("dashboard.usageCols.tokens")}</th>
            <th className="py-1 font-medium">{t("dashboard.usageCols.cache")}</th>
            <th className="py-1 font-medium">{t("dashboard.usageCols.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.category} className="border-t border-border">
              <td className="py-1 font-mono">{c.category}</td>
              <td className="py-1">{c.events}</td>
              <td className="py-1">{formatTokens(c.tokens)}</td>
              <td className="py-1">{formatTokens(c.cacheRead)}</td>
              <td className="py-1">
                {c.category.endsWith(".subagente") ? t("dashboard.usageInSession") : usd(c.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
