import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useApi, useTimezone } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { t } from "../../i18n";
import { formatDate } from "../../lib/format";

/**
 * Configurações › Modo plugin (F04 §4, auditoria E1): estado do `/mcp` desta instância, a URL que o Claude Code do
 * computador usa, o comando de instalação e a última vez que o terminal falou com o app. Se o registro no Claude Code
 * está certo (porta, token) só o `./start.sh doctor` confere, porque roda no computador e não no container.
 */
export function PluginSettingsSection() {
  const api = useApi();
  const tz = useTimezone();
  const titleId = useId();
  const status = useQuery({ queryKey: ["plugin", "status"], queryFn: () => api.getPluginStatus() });
  const s = status.data;
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="text-sm font-semibold">
        {t("chat.plugin.title")}
      </h3>
      <p className="text-xs text-muted-fg">{t("chat.plugin.hint")}</p>
      {s ? (
        <>
          {s.mcp.ok ? (
            <Alert tone="ok">{t("chat.plugin.mcpOk", { count: s.mcp.tools })}</Alert>
          ) : (
            <Alert tone="danger">{t("chat.plugin.mcpFail")}</Alert>
          )}
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("chat.plugin.mcpUrl")}</span>
            <code className="rounded bg-muted px-2 py-1 text-xs">{s.mcpUrl}</code>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("chat.plugin.command")}</span>
            <code className="rounded bg-muted px-2 py-1 text-xs">{s.command}</code>
          </div>
          <p className="text-sm">
            {s.lastSeenAt
              ? t("chat.plugin.lastSeen", { date: formatDate(s.lastSeenAt, tz) })
              : t("chat.plugin.neverSeen")}
          </p>
          <div className="flex flex-col gap-1 text-xs text-muted-fg">
            <span>{t("chat.plugin.doctor")}</span>
            <code className="rounded bg-muted px-2 py-1">{s.doctorCommand}</code>
          </div>
        </>
      ) : null}
    </Card>
  );
}
