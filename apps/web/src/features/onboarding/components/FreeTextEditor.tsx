import { useEffect } from "react";
import { Textarea } from "../../../components/ui/input";
import { t } from "../../../i18n";

export const TEXT_MIN = 200;
export const TEXT_MAX = 50_000;
export const DRAFT_KEY = "narnia.draft.cv";

export function FreeTextEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Nome acessível do campo; padrão "Texto livre" (F01). A F03 usa o convite à história de carreira. */
  label?: string;
}) {
  useEffect(() => {
    try {
      if (value) localStorage.setItem(DRAFT_KEY, value);
    } catch {
      // storage indisponível
    }
  }, [value]);
  const tooShort = value.length > 0 && value.length < TEXT_MIN;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={label ?? t("source.tabText")}
        placeholder={t("source.textPlaceholder")}
        value={value}
        maxLength={TEXT_MAX}
        onChange={(e) => onChange(e.target.value.slice(0, TEXT_MAX))}
        className="min-h-64"
      />
      <div className="flex items-center justify-between text-xs text-muted-fg">
        <span>{t("source.textCount", { count: value.length, max: TEXT_MAX })}</span>
        {tooShort ? (
          <span className="text-danger">{t("source.textTooShort", { min: TEXT_MIN })}</span>
        ) : null}
        {value.length >= TEXT_MIN ? <span>{t("source.textDraftSaved")}</span> : null}
      </div>
    </div>
  );
}

export function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignorar
  }
}
