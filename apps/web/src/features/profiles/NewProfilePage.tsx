import { t } from "../../i18n";

export interface NewProfileSearch {
  cloneFrom?: string;
  suggestionId?: string;
  title?: string;
  seniority?: string;
  area?: string;
  market?: string;
}

/** `/perfis/novo` (F02 §4). Formulário completo entra no lote C do M4. */
export function NewProfilePage(_props: { search: NewProfileSearch }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("profiles.newTitle")}</h1>
      <p className="text-sm text-muted-fg">{t("profiles.newHint")}</p>
    </div>
  );
}
