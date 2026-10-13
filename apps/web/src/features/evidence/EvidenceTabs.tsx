import { NavLink } from "../../components/shell/NavLink";
import { t } from "../../i18n";

const tab =
  "inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted [&.active]:bg-muted [&.active]:font-medium";

/** Abas de Evidências: arquivos e textos ingeridos, repositórios analisados. */
export function EvidenceTabs() {
  return (
    <nav aria-label={t("evidence.tabs.label")} className="flex gap-2">
      <NavLink to="/evidencias/arquivos" className={tab}>
        {t("evidence.tabs.files")}
      </NavLink>
      <NavLink to="/evidencias/repositorios" className={tab}>
        {t("evidence.tabs.repos")}
      </NavLink>
    </nav>
  );
}
