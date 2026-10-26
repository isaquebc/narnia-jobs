import {
  ADDRESS_FORMS,
  type Link,
  type RemotePref,
  type UserUpsertRequest,
  type WorkAuth,
} from "@narnia-jobs/shared";
import { useState } from "react";
import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Field } from "../../../components/ui/field";
import { Input, Select } from "../../../components/ui/input";
import { type TKey, t } from "../../../i18n";
import { COUNTRIES, countryByCode, listTimezones } from "../countries";
import { PhoneInput, type PhoneParts, validatePhoneParts } from "./PhoneInput";

export interface IdentityValue {
  displayName: string;
  fullName: string;
  pronouns: string;
  email: string;
  phone: PhoneParts;
  city: string;
  region: string;
  country: string;
  timezone: string;
  remotePref: RemotePref;
  relocation: { mode: "none" | "country" | "anywhere"; countries: string[] };
  workAuth: WorkAuth[];
  links: Link[];
  /** Campos que vieram do currículo (para o selo "do currículo" / "não estava no currículo"). */
  fromCv: string[];
}

export interface IdentityProposalData {
  displayName?: string;
  fullName?: string;
  email?: string;
  phoneRaw?: string;
  city?: string;
  region?: string;
  country?: string;
  links?: Link[];
}

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
};

export function parsePhoneRaw(raw: string, country: string): PhoneParts {
  const digits = raw.replace(/\D/g, "");
  const info = countryByCode(country);
  const dial = (info?.dial ?? "").replace("+", "");
  const national = dial && digits.startsWith(dial) ? digits.slice(dial.length) : digits;
  const areaDigits = info?.areaDigits ?? 0;
  if (areaDigits > 0 && national.length > areaDigits) {
    return { country, area: national.slice(0, areaDigits), number: national.slice(areaDigits) };
  }
  return { country, area: "", number: national };
}

export function identityFromProposal(data: IdentityProposalData): IdentityValue {
  const country = data.country ?? "BR";
  const fromCv = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k]) => (k === "phoneRaw" ? "phone" : k));
  const fullName = data.fullName ?? "";
  return {
    displayName: data.displayName ?? (fullName ? (fullName.split(/\s+/)[0] as string) : ""),
    fullName,
    pronouns: "",
    email: data.email ?? "",
    phone: data.phoneRaw
      ? parsePhoneRaw(data.phoneRaw, country)
      : { country, area: "", number: "" },
    city: data.city ?? "",
    region: data.region ?? "",
    country,
    timezone: countryByCode(country)?.timezone ?? browserTz(),
    remotePref: "any",
    relocation: { mode: "none", countries: [] },
    workAuth: [{ country, status: "citizen" }],
    links: data.links ?? [],
    fromCv: data.fullName && !data.displayName ? [...fromCv, "displayName"] : fromCv,
  };
}

export type IdentityErrors = Partial<Record<keyof IdentityValue | "phone", string>>;

export function validateIdentity(v: IdentityValue): IdentityErrors {
  const errors: IdentityErrors = {};
  const req = t("app.required");
  if (!v.displayName.trim()) errors.displayName = req;
  if (!v.fullName.trim()) errors.fullName = req;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errors.email = req;
  const phone = validatePhoneParts(v.phone);
  if (!phone.ok) errors.phone = phone.message;
  if (!v.city.trim()) errors.city = req;
  if (!v.country) errors.country = req;
  if (!v.timezone) errors.timezone = req;
  if (
    v.relocation.mode !== "none" &&
    v.relocation.mode === "country" &&
    v.relocation.countries.length === 0
  ) {
    errors.relocation = req;
  }
  if (v.workAuth.length === 0) errors.workAuth = req;
  return errors;
}

export function toUserUpsertRequest(v: IdentityValue): UserUpsertRequest {
  const phone = validatePhoneParts(v.phone);
  const national = phone.ok
    ? phone.national
    : `${v.phone.area}${v.phone.number}`.replace(/\D/g, "");
  const dial = (countryByCode(v.phone.country)?.dial ?? "+").replace("+", "");
  return {
    displayName: v.displayName.trim(),
    fullName: v.fullName.trim(),
    ...(v.pronouns.trim() ? { pronouns: v.pronouns.trim() } : {}),
    email: v.email.trim(),
    phone: { e164: `+${dial}${national}`, country: v.phone.country, national },
    city: v.city.trim(),
    ...(v.region.trim() ? { region: v.region.trim() } : {}),
    country: v.country,
    timezone: v.timezone,
    remotePref: v.remotePref,
    relocation: v.relocation,
    workAuth: v.workAuth,
    links: v.links,
  };
}

const REMOTE: RemotePref[] = ["remote", "hybrid", "onsite", "any"];
const WORK_STATUS: WorkAuth["status"][] = [
  "citizen",
  "permanent_resident",
  "work_visa",
  "needs_sponsorship",
  "not_authorized",
];

function CvTag({ field, fromCv }: { field: string; fromCv: string[] }) {
  return fromCv.includes(field) ? (
    <Badge tone="ok">{t("identity.fromCv")}</Badge>
  ) : (
    <Badge>{t("identity.notInCv")}</Badge>
  );
}

export function IdentityForm({
  initial,
  onSubmit,
  submitLabel,
  footer,
  externalError,
}: {
  initial: IdentityValue;
  onSubmit: (value: IdentityValue) => void | Promise<void>;
  submitLabel: string;
  footer?: React.ReactNode;
  externalError?: string | null;
}) {
  const [value, setValue] = useState<IdentityValue>(initial);
  const [errors, setErrors] = useState<IdentityErrors>({});
  const [attempted, setAttempted] = useState(false);
  const set = <K extends keyof IdentityValue>(k: K, v: IdentityValue[K]) =>
    setValue((cur) => ({ ...cur, [k]: v }));
  const tzs = listTimezones();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateIdentity(value);
    setErrors(errs);
    setAttempted(true);
    if (Object.keys(errs).length > 0) return;
    void onSubmit(value);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h3 className="text-sm font-semibold">{t("review.identity")}</h3>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label={t("identity.displayName")}
          htmlFor="displayName"
          required
          error={errors.displayName}
          hint={<CvTag field="displayName" fromCv={value.fromCv} />}
        >
          <Input
            id="displayName"
            value={value.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            aria-invalid={Boolean(errors.displayName)}
          />
        </Field>
        <Field
          label={t("identity.fullName")}
          htmlFor="fullName"
          required
          error={errors.fullName}
          hint={<CvTag field="fullName" fromCv={value.fromCv} />}
        >
          <Input
            id="fullName"
            value={value.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            aria-invalid={Boolean(errors.fullName)}
          />
        </Field>
        {/* F12-23: como o narnia se refere à pessoa; nunca deduzido do nome */}
        <Field
          label={t("motivations.address")}
          htmlFor="pronouns"
          hint={<span className="text-xs text-muted-fg">{t("motivations.addressHint")}</span>}
        >
          <Select
            id="pronouns"
            value={value.pronouns || "neutro"}
            onChange={(e) => set("pronouns", e.target.value)}
          >
            {ADDRESS_FORMS.map((a) => (
              <option key={a} value={a}>
                {t(`motivations.addressOptions.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("identity.email")}
          htmlFor="email"
          required
          error={errors.email}
          hint={<CvTag field="email" fromCv={value.fromCv} />}
        >
          <Input
            id="email"
            type="email"
            value={value.email}
            onChange={(e) => set("email", e.target.value)}
            aria-invalid={Boolean(errors.email)}
          />
        </Field>
        <div className="flex flex-col gap-1">
          <PhoneInput
            value={value.phone}
            onChange={(phone) => set("phone", phone)}
            error={errors.phone}
          />
          <CvTag field="phone" fromCv={value.fromCv} />
        </div>
        <Field
          label={t("identity.city")}
          htmlFor="city"
          required
          error={errors.city}
          hint={<CvTag field="city" fromCv={value.fromCv} />}
        >
          <Input
            id="city"
            value={value.city}
            onChange={(e) => set("city", e.target.value)}
            aria-invalid={Boolean(errors.city)}
          />
        </Field>
        <Field label={t("identity.region")} htmlFor="region">
          <Input id="region" value={value.region} onChange={(e) => set("region", e.target.value)} />
        </Field>
        <Field label={t("identity.country")} htmlFor="country" required error={errors.country}>
          <Select
            id="country"
            value={value.country}
            onChange={(e) => set("country", e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("identity.timezone")} htmlFor="timezone" required error={errors.timezone}>
          <Input
            id="timezone"
            list="tz-list"
            value={value.timezone}
            placeholder={t("identity.timezoneSearch")}
            onChange={(e) => set("timezone", e.target.value)}
          />
          <datalist id="tz-list">
            {tzs.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>
        <Field label={t("identity.remotePref")} htmlFor="remotePref" required>
          <Select
            id="remotePref"
            value={value.remotePref}
            onChange={(e) => set("remotePref", e.target.value as RemotePref)}
          >
            {REMOTE.map((r) => (
              <option key={r} value={r}>
                {t(`identity.remote.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("identity.relocation")}
          htmlFor="relocation"
          required
          error={errors.relocation}
        >
          <Select
            id="relocation"
            value={value.relocation.mode}
            onChange={(e) =>
              set("relocation", {
                ...value.relocation,
                mode: e.target.value as IdentityValue["relocation"]["mode"],
              })
            }
          >
            {(["none", "country", "anywhere"] as const).map((m) => (
              <option key={m} value={m}>
                {t(`identity.relocationMode.${m}`)}
              </option>
            ))}
          </Select>
          {value.relocation.mode === "country" ? (
            <Input
              aria-label={t("identity.relocationCountries")}
              placeholder={t("identity.relocationCountries")}
              value={value.relocation.countries.join(", ")}
              onChange={(e) =>
                set("relocation", {
                  ...value.relocation,
                  countries: e.target.value
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter((s) => /^[A-Z]{2}$/.test(s)),
                })
              }
            />
          ) : null}
        </Field>
      </div>
      <Field label={t("identity.workAuth")} required error={errors.workAuth}>
        <ul className="flex flex-col gap-2">
          {value.workAuth.map((wa, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: linhas sem id próprio; a ordem é o identificador
            <li key={`${wa.country}-${i}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Select
                aria-label={t("identity.country")}
                value={wa.country}
                onChange={(e) =>
                  set(
                    "workAuth",
                    value.workAuth.map((w, idx) =>
                      idx === i ? { ...w, country: e.target.value } : w,
                    ),
                  )
                }
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t("identity.workAuth")}
                value={wa.status}
                onChange={(e) =>
                  set(
                    "workAuth",
                    value.workAuth.map((w, idx) =>
                      idx === i ? { ...w, status: e.target.value as WorkAuth["status"] } : w,
                    ),
                  )
                }
              >
                {WORK_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {t(`identity.workAuthStatus.${s}` as TKey)}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="sm"
                disabled={value.workAuth.length === 1}
                onClick={() =>
                  set(
                    "workAuth",
                    value.workAuth.filter((_, idx) => idx !== i),
                  )
                }
              >
                {t("source.remove")}
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              set("workAuth", [...value.workAuth, { country: "US", status: "needs_sponsorship" }])
            }
          >
            {t("identity.workAuthAdd")}
          </Button>
        </div>
      </Field>
      {footer}
      {attempted && Object.keys(errors).length > 0 ? (
        <Alert tone="danger">{t("review.missingRequired")}</Alert>
      ) : null}
      {externalError ? <Alert tone="danger">{externalError}</Alert> : null}
      <div className="flex justify-end">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
