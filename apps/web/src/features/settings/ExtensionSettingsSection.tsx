import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useApi, useTimezone } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { t } from "../../i18n";
import { formatDate } from "../../lib/format";

/**
 * Configurações › Extensão do navegador (F12/M1, F12-4, F12-9): tutorial de instalação, código de pareamento (uso
 * único, 10 minutos) com o endereço desta instância, e os navegadores conectados com desconectar.
 */
export function ExtensionSettingsSection() {
  const api = useApi();
  const tz = useTimezone();
  const qc = useQueryClient();
  const titleId = useId();
  const devices = useQuery({
    queryKey: ["extension", "devices"],
    queryFn: () => api.listExtensionDevices(),
  });
  const pairing = useMutation({ mutationFn: () => api.createExtensionPairing() });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeExtensionDevice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extension", "devices"] }),
  });
  const list = devices.data?.devices ?? [];
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="text-sm font-semibold">
        {t("extension.settingsTitle")}
      </h3>
      <p className="text-xs text-muted-fg">{t("extension.settingsHint")}</p>
      <Link
        to="/extensao"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t("extension.installLink")}
      </Link>
      <div className="flex flex-col gap-2">
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={pairing.isPending}
            onClick={() => pairing.mutate()}
          >
            {pairing.data ? t("extension.pairNew") : t("extension.pairButton")}
          </Button>
        </div>
        {pairing.isError ? <Alert tone="danger">{t("extension.pairFail")}</Alert> : null}
        {pairing.data ? (
          <div className="flex flex-col gap-1 rounded-md border border-border p-3">
            <span className="text-xs text-muted-fg">{t("extension.pairCode")}</span>
            <code className="font-mono text-2xl font-semibold tracking-widest">
              {pairing.data.code}
            </code>
            <p className="text-xs text-muted-fg">
              {t("extension.pairHint", {
                time: formatDate(pairing.data.expiresAt, tz, "HH:mm"),
              })}
            </p>
            <code className="rounded bg-muted px-2 py-1 text-xs">{window.location.origin}</code>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("extension.devices")}</span>
        {devices.isSuccess && list.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("extension.noDevices")}</p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {list.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{d.name}</span>
                <span className="text-xs text-muted-fg">
                  {d.lastSeenAt
                    ? t("extension.lastSeen", { date: formatDate(d.lastSeenAt, tz) })
                    : t("extension.neverUsed")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("extension.revokeLabel", { name: d.name })}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(d.id)}
              >
                {t("extension.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
