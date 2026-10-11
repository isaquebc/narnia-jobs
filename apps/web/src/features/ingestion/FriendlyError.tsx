import type { FriendlyErrorDto } from "@narnia-jobs/shared";
import { type TKey, t } from "../../i18n";

/** Erro em linguagem simples (plano de comunicação C5): mensagem, o que fazer e o texto técnico recolhido. */
export function FriendlyError({ error }: { error: FriendlyErrorDto }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{t(error.key as TKey)}</span>
      <span className="text-sm">{t(error.hint as TKey)}</span>
      {error.technical ? (
        <details className="text-xs text-muted-fg">
          <summary className="cursor-pointer">{t("runPage.technical")}</summary>
          <code className="break-all">{error.technical}</code>
        </details>
      ) : null}
    </div>
  );
}
