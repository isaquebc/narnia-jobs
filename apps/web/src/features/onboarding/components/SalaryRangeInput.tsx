import type { SalaryRange } from "@narnia-jobs/shared";
import { useEffect, useState } from "react";
import { Field } from "../../../components/ui/field";
import { Input, Select } from "../../../components/ui/input";
import { t } from "../../../i18n";
import { CURRENCIES } from "../countries";
import { DontKnow } from "./DontKnow";

const PERIODS = ["monthly", "yearly", "hourly"] as const;

export function SalaryRangeInput({
  value,
  dontKnow,
  onChange,
  onDontKnow,
  defaultCurrency = "BRL",
}: {
  value: SalaryRange | undefined;
  dontKnow: boolean;
  onChange: (v: SalaryRange) => void;
  onDontKnow: (v: boolean) => void;
  defaultCurrency?: string;
}) {
  // Texto dos campos numéricos fica em estado local para digitar sem o pai re-renderizar a cada tecla.
  const [minText, setMinText] = useState(value?.min ? String(value.min) : "");
  const [maxText, setMaxText] = useState(value?.max ? String(value.max) : "");
  const [currency, setCurrency] = useState(value?.currency ?? defaultCurrency);
  const [period, setPeriod] = useState<SalaryRange["period"]>(value?.period ?? "monthly");
  useEffect(() => {
    if (value) {
      setMinText(value.min ? String(value.min) : "");
      setMaxText(value.max ? String(value.max) : "");
      setCurrency(value.currency);
      setPeriod(value.period);
    }
  }, [value]);

  const emit = (next: {
    min?: string;
    max?: string;
    currency?: string;
    period?: SalaryRange["period"];
  }) => {
    const min = Number((next.min ?? minText).replace(/\D/g, "")) || 0;
    const max = Number((next.max ?? maxText).replace(/\D/g, "")) || 0;
    onChange({ min, max, currency: next.currency ?? currency, period: next.period ?? period });
  };
  const min = Number(minText) || 0;
  const max = Number(maxText) || 0;
  const invalid = min > 0 && max > 0 && min > max;
  return (
    <Field
      label={t("profile.salary")}
      required
      error={invalid ? t("profile.salaryInvalid") : undefined}
    >
      <div className="grid grid-cols-4 gap-2">
        <Input
          aria-label={t("profile.salaryMin")}
          inputMode="numeric"
          placeholder={t("profile.salaryMin")}
          disabled={dontKnow}
          value={minText}
          onChange={(e) => {
            setMinText(e.target.value);
            emit({ min: e.target.value });
          }}
        />
        <Input
          aria-label={t("profile.salaryMax")}
          inputMode="numeric"
          placeholder={t("profile.salaryMax")}
          disabled={dontKnow}
          value={maxText}
          onChange={(e) => {
            setMaxText(e.target.value);
            emit({ max: e.target.value });
          }}
        />
        <Select
          aria-label={t("profile.currency")}
          disabled={dontKnow}
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value);
            emit({ currency: e.target.value });
          }}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("profile.period")}
          disabled={dontKnow}
          value={period}
          onChange={(e) => {
            const p = e.target.value as SalaryRange["period"];
            setPeriod(p);
            emit({ period: p });
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`profile.periods.${p}`)}
            </option>
          ))}
        </Select>
      </div>
      <DontKnow checked={dontKnow} onChange={onDontKnow} />
    </Field>
  );
}
