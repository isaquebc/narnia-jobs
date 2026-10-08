import { Field } from "../../../components/ui/field";
import { t } from "../../../i18n";
import { DontKnow } from "./DontKnow";

export const CONTRACT_TYPES = ["clt", "pj", "freelance", "internship", "temporary"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export function ContractTypes({
  value,
  dontKnow,
  onChange,
  onDontKnow,
}: {
  value: ContractType[];
  dontKnow: boolean;
  onChange: (v: ContractType[]) => void;
  onDontKnow: (v: boolean) => void;
}) {
  return (
    <Field label={t("profile.contractTypes")} required>
      <div className="flex flex-wrap gap-3">
        {CONTRACT_TYPES.map((c) => {
          const checked = value.includes(c);
          const label = t(`profile.contracts.${c}`);
          return (
            <label key={c} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                aria-label={label}
                disabled={dontKnow}
                checked={checked}
                onChange={() => onChange(checked ? value.filter((v) => v !== c) : [...value, c])}
              />
              {label}
            </label>
          );
        })}
      </div>
      <DontKnow checked={dontKnow} onChange={onDontKnow} />
    </Field>
  );
}
