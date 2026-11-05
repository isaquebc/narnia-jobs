import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { t } from "../../i18n";
import type { SemanticSearchView } from "../../lib/api";

/**
 * Configurações › Busca por sentido (F04-fix-fundamentacao, R6, FF-5, FF-7): opcional. O aviso aparece quando os fatos
 * não cabem mais no índice do contexto do recrutador; dá para ligar antes. Enquanto baixa e prepara, o estado é
 * consultado a cada segundo.
 */
const KEY = ["settings", "semantic-search"];

function statusText(v: SemanticSearchView): string {
  switch (v.status) {
    case "loading":
      return v.progress !== null && v.progress < 1
        ? t("settings.semanticSearch.status.downloading", { pct: Math.round(v.progress * 100) })
        : t("settings.semanticSearch.status.loading");
    case "indexing":
      return t("settings.semanticSearch.status.indexing");
    case "ready":
      return t("settings.semanticSearch.status.ready", { n: v.vectors });
    case "error":
      return t("settings.semanticSearch.status.error", { error: v.error ?? "" });
    default:
      return t("settings.semanticSearch.status.off");
  }
}

export function SemanticSearchSection() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.getSemanticSearch(),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "loading" || s === "indexing" ? 1000 : false;
    },
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) => api.putSemanticSearch({ enabled }),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
  const v = q.data;
  const title = t("settings.semanticSearch.title");
  return (
    <Card id="busca-por-sentido" className="flex flex-col gap-3" role="region" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-fg">{t("settings.semanticSearch.hint")}</p>
      {v?.alert ? (
        <Alert tone="warn">{t("settings.semanticSearch.alert", { n: v.cutFacts })}</Alert>
      ) : null}
      {v ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm" aria-live="polite">
            {statusText(v)}
          </p>
          {v.status === "error" ? (
            <Button
              type="button"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate(true)}
            >
              {t("settings.semanticSearch.retry")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={v.enabled ? "ghost" : "primary"}
            disabled={save.isPending}
            onClick={() => save.mutate(!v.enabled)}
          >
            {v.enabled ? t("settings.semanticSearch.disable") : t("settings.semanticSearch.enable")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
