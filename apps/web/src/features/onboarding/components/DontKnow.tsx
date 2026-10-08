import { useId } from "react";
import { t } from "../../../i18n";

export function DontKnow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={t("app.dontKnow")}
      />
      <label htmlFor={id}>{t("app.dontKnow")}</label>
      {checked ? <span className="text-xs text-warn">{t("profile.researchLater")}</span> : null}
    </div>
  );
}
