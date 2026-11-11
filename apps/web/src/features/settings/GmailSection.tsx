import type { GmailStatusView } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { useApi, useWs } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { type TKey, t } from "../../i18n";
import { MailFeedSettings } from "./MailFeedSettings";
import { MailSenders } from "./MailSenders";
import { MailWindow } from "./MailWindow";

const TONE = {
  connected: "ok",
  needs_reconnect: "warn",
  disconnected: "neutral",
  not_configured: "neutral",
} as const;
const key = ["integrations", "gmail"] as const;

/**
 * Configurações › Gmail (F14-4, plans/plan-v0/tasks/F14-leitura-de-emails.md): cliente OAuth da própria pessoa (do
 * .env ou salvo aqui; o segredo nunca volta), conectar pelo login do Google numa aba nova e desconectar.
 */
export function GmailSection() {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const titleId = useId();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => api.getGmailStatus() });
  const set = (s: GmailStatusView) => qc.setQueryData(key, s);
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "gmail.updated") void qc.invalidateQueries({ queryKey: key });
    });
  }, [ws, qc]);
  const saveClient = useMutation({
    mutationFn: () => api.putGmailClient({ clientId, clientSecret }),
    onSuccess: (s) => {
      setClientSecret("");
      set(s);
    },
  });
  const removeClient = useMutation({ mutationFn: () => api.deleteGmailClient(), onSuccess: set });
  const connect = useMutation({
    mutationFn: () => api.connectGmail(),
    onSuccess: ({ authUrl: url, ...s }) => {
      set(s);
      setAuthUrl(url);
      window.open(url, "_blank", "noopener");
    },
  });
  const disconnect = useMutation({ mutationFn: () => api.disconnectGmail(), onSuccess: set });
  const s = q.data;
  const error = (connect.error ?? saveClient.error ?? disconnect.error) as Error | null;
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          {t("integrations.gmail.title")}
        </h3>
        {s ? (
          <Badge tone={TONE[s.status]}>{t(`integrations.gmail.status.${s.status}` as TKey)}</Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-fg">{t("integrations.gmail.hint")}</p>
      {s?.email && s.status !== "disconnected" ? (
        <p className="text-sm">{t("integrations.gmail.connectedAs", { email: s.email })}</p>
      ) : null}
      {s?.status === "connected" ? <MailWindow /> : null}
      {s?.status === "connected" ? <MailFeedSettings /> : null}
      {s && s.status !== "not_configured" ? <MailSenders /> : null}
      {s && s.status !== "not_configured" ? (
        <Link to="/emails" className="text-sm underline">
          {t("integrations.gmail.reviewLink")}
        </Link>
      ) : null}
      {s?.status === "needs_reconnect" ? (
        <Alert tone="warn">{t("integrations.gmail.needsReconnect")}</Alert>
      ) : null}
      {s?.lastError ? <Alert tone="danger">{s.lastError}</Alert> : null}
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {s?.status === "not_configured" ? (
        <form
          className="flex flex-col gap-2"
          aria-label={t("integrations.gmail.clientTitle")}
          onSubmit={(e) => {
            e.preventDefault();
            saveClient.mutate();
          }}
        >
          <p className="text-sm">
            {t("integrations.gmail.clientHint")}{" "}
            <code className="rounded bg-muted px-1 text-xs">{s.redirectUri}</code>
          </p>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${titleId}-id`}>{t("integrations.gmail.clientId")}</label>
            <Input
              id={`${titleId}-id`}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${titleId}-secret`}>{t("integrations.gmail.clientSecret")}</label>
            <Input
              id={`${titleId}-secret`}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={!clientId.trim() || !clientSecret.trim() || saveClient.isPending}
            >
              {t("integrations.gmail.saveClient")}
            </Button>
          </div>
        </form>
      ) : null}
      {s && s.status !== "not_configured" ? (
        <p className="text-xs text-muted-fg">
          {s.clientSource === "env"
            ? t("integrations.gmail.clientFromEnv", { hint: s.clientIdHint ?? "" })
            : t("integrations.gmail.clientFromSettings", { hint: s.clientIdHint ?? "" })}
        </p>
      ) : null}
      {s?.connecting ? (
        <p className="text-sm">
          {t("integrations.gmail.connecting")}{" "}
          {authUrl ? (
            <a href={authUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {t("integrations.gmail.openLogin")}
            </a>
          ) : null}
        </p>
      ) : null}
      {s && s.status !== "not_configured" ? (
        <div className="flex flex-wrap gap-2">
          {s.status !== "connected" ? (
            <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
              {s.status === "needs_reconnect"
                ? t("integrations.gmail.reconnect")
                : t("integrations.gmail.connect")}
            </Button>
          ) : null}
          {s.status !== "disconnected" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() => {
                if (window.confirm(t("integrations.gmail.disconnectConfirm"))) disconnect.mutate();
              }}
            >
              {t("integrations.gmail.disconnect")}
            </Button>
          ) : null}
          {s.clientSource === "settings" && s.status === "disconnected" ? (
            <Button size="sm" variant="ghost" onClick={() => removeClient.mutate()}>
              {t("integrations.gmail.removeClient")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
