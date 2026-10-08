import { providerLabel } from "../../../components/shell/ProviderIndicator";
import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardTitle } from "../../../components/ui/card";
import { Code, CommandLine } from "../../../components/ui/code";
import { useProviderStatus } from "../../../hooks/useProviderStatus";
import { t } from "../../../i18n";

export function LoginInstructions() {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t("provider.login.title")}</h3>
      <div className="rounded-md border border-primary/40 p-3">
        <p className="text-sm font-medium">{t("provider.login.primary")}</p>
        <p className="mb-2 text-xs text-muted-fg">{t("provider.login.primaryHint")}</p>
        <CommandLine command="./start.sh login" />
      </div>
      <div className="rounded-md border border-border p-3">
        <p className="text-sm font-medium">{t("provider.login.alternative")}</p>
        <p className="text-xs text-muted-fg">{t("provider.login.alternativeHint")}</p>
        <div className="mt-2">
          <Code>claude setup-token</Code>
        </div>
      </div>
      <p className="text-xs text-muted-fg">{t("provider.login.afterwards")}</p>
    </div>
  );
}

export function ProviderCard({ onReady }: { onReady?: (ready: boolean) => void }) {
  const { data, isLoading, isError, error, recheck, isFetching } = useProviderStatus();
  const ready = Boolean(data?.installed && data?.loggedIn);
  onReady?.(ready);
  const state = data ? providerLabel(data) : null;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <CardTitle>{t("provider.title")}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => void recheck()} disabled={isFetching}>
          {t("provider.recheck")}
        </Button>
      </div>
      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <input type="radio" checked readOnly aria-label={t("provider.claudeCode")} />
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-medium">{t("provider.claudeCode")}</span>
          {isLoading ? (
            <span className="text-xs text-muted-fg">{t("provider.checking")}</span>
          ) : null}
          {isError ? (
            <span className="text-xs text-danger">
              {t("errors.generic", { message: (error as Error).message })}
            </span>
          ) : null}
          {data && state ? (
            <div className="flex items-center gap-2 text-xs">
              <Badge tone={state.tone}>{state.label}</Badge>
              {data.version ? (
                <span className="text-muted-fg">
                  {t("provider.version", { version: data.version })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-3 opacity-60">
        <input type="radio" disabled aria-label={t("provider.codexSoon")} />
        <span className="text-sm">{t("provider.codexSoon")}</span>
      </div>
      {data && !data.installed ? (
        <Alert tone="danger">
          <p>{t("provider.execError")}</p>
          <p className="text-xs">{t("provider.execErrorHint")}</p>
        </Alert>
      ) : null}
      {data?.installed && !data.loggedIn ? <LoginInstructions /> : null}
      <p className="text-xs text-muted-fg">{t("provider.privacy")}</p>
    </Card>
  );
}
