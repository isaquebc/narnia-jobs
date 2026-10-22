import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { Card } from "../../components/ui/card";
import { t } from "../../i18n";

/** Configurações › Extensão do navegador (F12): por enquanto só o caminho para o tutorial de instalação. */
export function ExtensionSettingsSection() {
  const titleId = useId();
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
    </Card>
  );
}
