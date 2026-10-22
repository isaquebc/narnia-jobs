import { useId } from "react";
import { Alert } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { CommandLine } from "../../components/ui/code";
import { t } from "../../i18n";

/**
 * Tutorial de instalação da extensão do Chrome (F12-8, F12-10): extensão sem compactação, gerada no Docker
 * (`./start.sh extension` ou pelo `promote`), carregada uma vez em `chrome://extensions` e pareada com esta instância.
 * O endereço mostrado é o desta página, o mesmo que a extensão usa para abrir a janela.
 */
export const EXTENSION_DIR = "apps/extension/dist";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const titleId = useId();
  return (
    <li aria-labelledby={titleId} className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

export function ExtensionInstallPage() {
  const origin = window.location.origin;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("extension.title")}</h1>
      <p className="text-sm text-muted-fg">{t("extension.intro")}</p>
      <Alert tone="warn">{t("extension.wip")}</Alert>
      <Card className="flex flex-col gap-4">
        <ol aria-label={t("extension.stepsLabel")} className="flex flex-col gap-5">
          <Step n={1} title={t("extension.step.build.title")}>
            <p className="text-sm">{t("extension.step.build.body")}</p>
            <span className="text-xs text-muted-fg">{t("extension.step.build.linux")}</span>
            <CommandLine command="./start.sh extension" />
            <span className="text-xs text-muted-fg">{t("extension.step.build.windows")}</span>
            <CommandLine command=".\start.ps1 extension" />
          </Step>
          <Step n={2} title={t("extension.step.open.title")}>
            <p className="text-sm">{t("extension.step.open.body")}</p>
            <CommandLine command="chrome://extensions" />
          </Step>
          <Step n={3} title={t("extension.step.devMode.title")}>
            <p className="text-sm">{t("extension.step.devMode.body")}</p>
          </Step>
          <Step n={4} title={t("extension.step.load.title")}>
            <p className="text-sm">{t("extension.step.load.body")}</p>
            <CommandLine command={EXTENSION_DIR} />
            <p className="text-xs text-muted-fg">{t("extension.step.load.ownerSrc")}</p>
          </Step>
          <Step n={5} title={t("extension.step.pin.title")}>
            <p className="text-sm">{t("extension.step.pin.body")}</p>
          </Step>
          <Step n={6} title={t("extension.step.pair.title")}>
            <p className="text-sm">{t("extension.step.pair.body")}</p>
            <CommandLine command={origin} />
            <p className="text-sm">{t("extension.step.pair.code")}</p>
          </Step>
        </ol>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("extension.use.title")}</h2>
        <p className="text-sm">{t("extension.use.body")}</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("extension.update.title")}</h2>
        <p className="text-sm">{t("extension.update.body")}</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("extension.trouble.title")}</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>{t("extension.trouble.manifest")}</li>
          <li>{t("extension.trouble.offline")}</li>
          <li>{t("extension.trouble.code")}</li>
          <li>{t("extension.trouble.warning")}</li>
        </ul>
      </Card>
    </div>
  );
}
