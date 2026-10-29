import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { useFactAliases } from "../../hooks/useChat";
import { t } from "../../i18n";

/**
 * Configurações › termos aprendidos pela busca (F04-fix-fundamentacao, FF-1): quando a busca por um termo não achava um
 * fato, o recrutador ligou o termo ao fato; a lista mostra termo → fato e deixa apagar.
 */
export function FactAliasesSection() {
  const { aliases, remove } = useFactAliases();
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("settings.factAliases.title")}</h2>
      <p className="text-sm text-muted-fg">{t("settings.factAliases.hint")}</p>
      {aliases.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("settings.factAliases.empty")}</p>
      ) : (
        <ul aria-label={t("settings.factAliases.title")} className="flex flex-col gap-1 text-sm">
          {aliases.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{a.term}</span> →{" "}
                {a.factLabel ?? t("settings.factAliases.orphan")}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={t("settings.factAliases.remove", { term: a.term })}
                onClick={() => remove.mutate(a.id)}
              >
                {t("settings.factAliases.removeShort")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
