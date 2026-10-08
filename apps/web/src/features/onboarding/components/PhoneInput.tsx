import { useState } from "react";
import { Field } from "../../../components/ui/field";
import { Input, Select } from "../../../components/ui/input";
import { t } from "../../../i18n";
import { COUNTRIES, countryByCode } from "../countries";

export interface PhoneParts {
  country: string;
  area: string;
  number: string;
}

export type PhoneValidation =
  | { ok: true; national: string }
  | { ok: false; field: "area" | "number"; message: string };

/** Validação local (país + DDD + número → nacional só dígitos). O servidor valida de novo com libphonenumber. */
export function validatePhoneParts(p: PhoneParts): PhoneValidation {
  const info = countryByCode(p.country);
  const area = p.area.replace(/\D/g, "");
  const number = p.number.replace(/\D/g, "");
  const areaDigits = info?.areaDigits ?? 0;
  if (areaDigits > 0 && area.length !== areaDigits) {
    return { ok: false, field: "area", message: t("identity.phoneAreaInvalid") };
  }
  const [min, max] = info?.numberDigits ?? [4, 15];
  if (number.length < min || number.length > max) {
    return { ok: false, field: "number", message: t("identity.phoneInvalid") };
  }
  return { ok: true, national: `${areaDigits > 0 ? area : ""}${number}` };
}

export function PhoneInput({
  value,
  onChange,
  error,
  idPrefix = "phone",
}: {
  value: PhoneParts;
  onChange: (v: PhoneParts) => void;
  error?: string | undefined;
  idPrefix?: string | undefined;
}) {
  const [touched, setTouched] = useState(false);
  const info = countryByCode(value.country);
  const validation = validatePhoneParts(value);
  const localError = touched && !validation.ok ? validation.message : undefined;
  const shownError = error ?? localError;
  const hasArea = (info?.areaDigits ?? 0) > 0;
  return (
    <Field label={t("identity.phone")} required error={shownError}>
      <div className="flex gap-2">
        <div className="flex w-56 items-center gap-1">
          <Select
            id={`${idPrefix}-country`}
            aria-label={t("identity.phoneCountry")}
            value={value.country}
            onChange={(e) => onChange({ ...value, country: e.target.value })}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
          <span className="w-14 shrink-0 text-sm text-muted-fg">{info?.dial ?? ""}</span>
        </div>
        {hasArea ? (
          <Input
            id={`${idPrefix}-area`}
            aria-label={t("identity.phoneArea")}
            inputMode="numeric"
            className="w-20"
            placeholder={t("identity.phoneArea")}
            value={value.area}
            onChange={(e) => onChange({ ...value, area: e.target.value })}
            onBlur={() => setTouched(true)}
            aria-invalid={Boolean(
              shownError && (!validation.ok ? validation.field === "area" : false),
            )}
          />
        ) : null}
        <Input
          id={`${idPrefix}-number`}
          aria-label={t("identity.phoneNumber")}
          inputMode="tel"
          placeholder={t("identity.phoneNumber")}
          value={value.number}
          onChange={(e) => onChange({ ...value, number: e.target.value })}
          onBlur={() => setTouched(true)}
          aria-invalid={Boolean(
            shownError && (!validation.ok ? validation.field === "number" : true),
          )}
        />
      </div>
    </Field>
  );
}
