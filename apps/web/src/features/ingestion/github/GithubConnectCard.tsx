import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { CopyButton } from "../../../components/ui/copy-button";
import { useGithubAuth } from "../../../hooks/useGithubAuth";
import { t } from "../../../i18n";
import type { GithubAuthSource } from "../../../lib/api";

function remaining(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
}

function mmss(total: number): string {
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Conexão do GitHub (F03-1): origem da credencial (gh do computador ou login próprio do app) e o fluxo de dispositivo
 * sem terminal: código com copiar, "Abrir GitHub" em nova aba, contagem dos 15 min e conclusão pelo WS.
 */
export function GithubConnectCard() {
  const { data: status, setSource, startDevice, disconnect } = useGithubAuth();
  const [now, setNow] = useState(() => Date.now());
  const device = startDevice.data;
  const left = device ? remaining(device.expiresAt, now) : 0;

  // o código só vale para uma autorização: conectado, ele é descartado (desconectar depois oferece um novo)
  const resetDevice = startDevice.reset;
  useEffect(() => {
    if (status?.connected && device) resetDevice();
  }, [status?.connected, device, resetDevice]);

  useEffect(() => {
    if (!device || status?.connected) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [device, status?.connected]);

  if (!status) return null;
  const choose = (source: GithubAuthSource) => setSource.mutate(source);

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("github.connect.title")}</h2>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{t("github.connect.sourceLegend")}</legend>
        {(["host", "app"] as const).map((source) => (
          <label key={source} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="github-auth-source"
              checked={status.source === source}
              onChange={() => choose(source)}
            />
            {t(`github.connect.source.${source}`)}
          </label>
        ))}
      </fieldset>

      {status.connected ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ok">
            {t("github.connect.connectedAs", { login: status.login ?? "?" })}
          </span>
          {status.scopes.length > 0 ? (
            <span className="text-xs text-muted-fg">
              {t("github.connect.scopes", { scopes: status.scopes.join(", ") })}
            </span>
          ) : null}
          {status.source === "app" ? (
            <div>
              <Button size="sm" variant="outline" onClick={() => disconnect.mutate()}>
                {t("github.connect.disconnect")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {status.source === "host" && !status.hostAvailable ? (
            <Alert tone="warn" className="flex flex-col gap-2">
              <span>{t("github.connect.hostMissing")}</span>
              <div>
                <Button size="sm" variant="outline" onClick={() => choose("app")}>
                  {t("github.connect.useApp")}
                </Button>
              </div>
            </Alert>
          ) : null}
          {status.source === "app" ? (
            <>
              <p className="text-sm text-muted-fg">{t("github.connect.privateScopeHint")}</p>
              {!device ? (
                <div className="flex flex-col gap-2">
                  <div>
                    <Button onClick={() => startDevice.mutate()} disabled={startDevice.isPending}>
                      {t("github.connect.connect")}
                    </Button>
                  </div>
                  {startDevice.error ? (
                    <Alert tone="danger">
                      {t("github.connect.startError", {
                        message:
                          startDevice.error instanceof Error ? startDevice.error.message : "",
                      })}
                    </Alert>
                  ) : null}
                </div>
              ) : left === 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-danger">{t("github.connect.expired")}</span>
                  <div>
                    <Button size="sm" onClick={() => startDevice.mutate()}>
                      {t("github.connect.newCode")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm">{t("github.connect.codeHint")}</span>
                  <div className="flex items-center gap-3">
                    <code className="rounded-md bg-muted px-3 py-2 font-mono text-2xl tracking-widest">
                      {device.code}
                    </code>
                    <CopyButton text={device.code} />
                    <a
                      href={device.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-fg hover:opacity-90"
                    >
                      {t("github.connect.openGithub")}
                    </a>
                  </div>
                  <span className="text-xs text-muted-fg">
                    {t("github.connect.expiresIn", { time: mmss(left) })}
                  </span>
                  <span className="text-xs text-muted-fg">{t("github.connect.waiting")}</span>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}
