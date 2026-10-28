import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { type TKey, t } from "../../i18n";

const TONE = {
  connected: "ok",
  needs_auth: "warn",
  not_configured: "neutral",
  error: "danger",
  unavailable: "neutral",
} as const;

/**
 * Configurações › Google Calendar (F07/M7, F07-4: opcional). Mostra se o MCP oficial do Google está registrado e
 * autenticado no Claude Code do container e o passo a passo com o cliente OAuth da própria pessoa. Sem conexão, a
 * agenda das candidaturas já funciona com o link do modelo e o `.ics`; conectado, o recrutador cria os eventos.
 */
export function GoogleCalendarSection() {
  const api = useApi();
  const qc = useQueryClient();
  const titleId = useId();
  const q = useQuery({
    queryKey: ["integrations", "google-calendar"],
    queryFn: () => api.getGoogleCalendarStatus(false),
  });
  const s = q.data;
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          {t("integrations.google.title")}
        </h3>
        {s ? (
          <Badge tone={TONE[s.status]}>{t(`integrations.google.status.${s.status}` as TKey)}</Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-fg">{t("integrations.google.hint")}</p>
      {s?.detail ? <Alert tone="warn">{s.detail}</Alert> : null}
      {s && s.status !== "connected" ? (
        <ol
          aria-label={t("integrations.google.steps")}
          className="flex list-decimal flex-col gap-2 pl-5 text-sm"
        >
          <li>
            {t("integrations.google.step1")}{" "}
            <code className="rounded bg-muted px-1 text-xs">{s.redirectUri}</code>
          </li>
          <li>
            {t("integrations.google.step2")}
            <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs">
              ./start.sh google connect &lt;SEU_CLIENT_ID&gt;
            </code>
          </li>
          <li>{t("integrations.google.step3")}</li>
          <li>
            {t("integrations.google.manual")}
            <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs">{s.steps.add}</code>
            <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs">{s.steps.login}</code>
          </li>
        </ol>
      ) : null}
      {s?.status === "connected" ? (
        <p className="text-sm">{t("integrations.google.connectedHint")}</p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={q.isFetching}
          onClick={async () => {
            const fresh = await api.getGoogleCalendarStatus(true);
            qc.setQueryData(["integrations", "google-calendar"], fresh);
          }}
        >
          {t("integrations.google.refresh")}
        </Button>
      </div>
    </Card>
  );
}
