import { t } from "../../i18n";

/** Configurações › Integrações (F03 §4). */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
    </div>
  );
}
