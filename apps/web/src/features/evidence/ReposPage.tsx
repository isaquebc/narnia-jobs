import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { useRepos } from "../../hooks/useRepos";
import { t } from "../../i18n";
import { EvidenceTabs } from "./EvidenceTabs";

/** Evidências › Repositórios (F03 §4): relevância, último commit analisado e acesso ao detalhe. */
export function ReposPage() {
  const repos = useRepos();
  const list = repos.data?.repos ?? [];
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("evidence.title")}</h1>
      <EvidenceTabs />
      {repos.isLoading ? <p className="text-sm text-muted-fg">{t("app.loading")}</p> : null}
      {!repos.isLoading && list.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-fg">{t("evidence.empty")}</p>
          <div>
            <NavLink
              to="/ingestao"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-fg hover:opacity-90"
            >
              {t("evidence.goIngest")}
            </NavLink>
          </div>
        </div>
      ) : null}
      {list.length > 0 ? (
        <ul aria-label={t("evidence.list")} className="flex flex-col gap-2">
          {list.map((r) => (
            <li
              key={r.id}
              aria-label={r.fullName}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{r.fullName}</span>
                {r.description ? (
                  <span className="truncate text-xs text-muted-fg">{r.description}</span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {r.relevance !== null ? (
                    <Badge tone="info">
                      {t("evidence.relevance", { pct: Math.round(r.relevance * 100) })}
                    </Badge>
                  ) : null}
                  {r.lastAnalysisId && r.headSha ? (
                    <span className="text-muted-fg">
                      {t("evidence.commit", { sha: r.headSha.slice(0, 7) })}
                    </span>
                  ) : (
                    <span className="text-muted-fg">{t("evidence.notAnalyzed")}</span>
                  )}
                </div>
              </div>
              <NavLink
                to={`/evidencias/repositorios/${r.id}`}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
              >
                {t("evidence.details")}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
