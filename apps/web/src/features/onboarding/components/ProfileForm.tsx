import type { ProfileCreateRequest, SalaryRange, SalaryReference } from "@narnia-jobs/shared";
import { type ReactNode, useEffect, useState } from "react";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Field } from "../../../components/ui/field";
import { Input, Select } from "../../../components/ui/input";
import { t } from "../../../i18n";
import type { ProfileSuggestion } from "../../../lib/api";
import { COUNTRIES, countryByCode } from "../countries";
import { type ContractType, ContractTypes } from "./ContractTypes";
import { type LocationPref, LocationsInput } from "./LocationsInput";
import { SalaryRangeInput } from "./SalaryRangeInput";
import { SalaryReferenceAlert } from "./SalaryReferenceAlert";

const SENIORITIES = ["junior", "pleno", "senior", "staff", "manager", "director"] as const;
const GOALS = ["new_job", "career_change", "freelance", "promotion"] as const;
type Seniority = (typeof SENIORITIES)[number];
type Goal = (typeof GOALS)[number];
type Researchable = "salary" | "contractTypes" | "locations" | "availableFrom";

/** Valores iniciais (F02: clonar ou aceitar sugestão). Carreira nunca vem pré-preenchida (F02-8). */
export interface ProfileFormInitial {
  name?: string;
  targetTitle?: string;
  altTitles?: string[];
  seniority?: Seniority;
  area?: string;
  goal?: Goal;
  market?: string;
  docLocale?: string;
}

export function ProfileForm({
  suggestion,
  initial,
  userCountry,
  reference,
  onSubmit,
  submitting,
  externalError,
  submitLabel,
  banner,
  onDirty,
}: {
  suggestion: ProfileSuggestion | null;
  initial?: ProfileFormInitial;
  userCountry: string;
  reference: SalaryReference | null;
  onSubmit: (body: ProfileCreateRequest) => void | Promise<void>;
  submitting?: boolean;
  externalError?: string | null;
  submitLabel?: string;
  /** Substitui o aviso de sugestão do F01 (ex.: "pré-preenchido a partir da sugestão"). */
  banner?: ReactNode;
  onDirty?: () => void;
}) {
  const info = countryByCode(userCountry);
  const [name, setName] = useState(initial?.name ?? suggestion?.targetTitle ?? "");
  const [targetTitle, setTargetTitle] = useState(
    initial?.targetTitle ?? suggestion?.targetTitle ?? "",
  );
  const [altTitles, setAltTitles] = useState(
    (initial?.altTitles ?? suggestion?.altTitles ?? []).join(", "),
  );
  const [seniority, setSeniority] = useState<Seniority>(
    initial?.seniority ?? (suggestion?.seniority as Seniority | null) ?? "pleno",
  );
  const [area, setArea] = useState(initial?.area ?? suggestion?.area ?? "");
  const [goal, setGoal] = useState<Goal>(initial?.goal ?? "new_job");
  const [market, setMarket] = useState(initial?.market ?? userCountry);
  const [docLocale, setDocLocale] = useState(
    initial?.docLocale ?? (userCountry === "BR" ? "pt-BR" : "en-US"),
  );
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) onDirty?.();
  }, [touched, onDirty]);
  const [salary, setSalary] = useState<SalaryRange | undefined>(undefined);
  const [contractTypes, setContractTypes] = useState<ContractType[]>([]);
  const [locations, setLocations] = useState<LocationPref[]>([
    { country: userCountry, remote: "any" },
  ]);
  const [availableMode, setAvailableMode] = useState<"immediate" | "date">("immediate");
  const [availableDate, setAvailableDate] = useState("");
  const [dontKnow, setDontKnow] = useState<Record<Researchable, boolean>>({
    salary: false,
    contractTypes: false,
    locations: false,
    availableFrom: false,
  });
  const [errors, setErrors] = useState<string[]>([]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!name.trim()) errs.push(t("profile.name"));
    if (!targetTitle.trim()) errs.push(t("profile.targetTitle"));
    if (!area.trim()) errs.push(t("profile.area"));
    const needsResearch = (Object.keys(dontKnow) as Researchable[]).filter((k) => dontKnow[k]);
    const salaryOk =
      dontKnow.salary || (salary && salary.min > 0 && salary.max > 0 && salary.min <= salary.max);
    if (!salaryOk) errs.push(t("profile.salary"));
    if (!dontKnow.contractTypes && contractTypes.length === 0)
      errs.push(t("profile.contractTypes"));
    if (!dontKnow.locations && locations.length === 0) errs.push(t("profile.locations"));
    if (!dontKnow.availableFrom && availableMode === "date" && !availableDate)
      errs.push(t("profile.availableFrom"));
    setErrors(errs);
    if (errs.length > 0) return;
    const body: ProfileCreateRequest = {
      name: name.trim(),
      targetTitle: targetTitle.trim(),
      altTitles: altTitles
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      seniority,
      area: area.trim(),
      goal,
      market,
      docLocale,
      ...(dontKnow.salary || !salary ? {} : { salary }),
      contractTypes: dontKnow.contractTypes ? [] : contractTypes,
      locations: dontKnow.locations ? [] : locations,
      ...(dontKnow.availableFrom
        ? {}
        : {
            availableFrom: availableMode === "immediate" ? ("immediate" as const) : availableDate,
          }),
      needsResearch,
    };
    void onSubmit(body);
  }

  return (
    <form
      onSubmit={submit}
      onChange={() => setTouched(true)}
      className="flex flex-col gap-5"
      noValidate
    >
      {banner !== undefined ? (
        banner
      ) : suggestion?.reasons?.length ? (
        <Alert>{t("profile.suggested", { reason: suggestion.reasons.join("; ") })}</Alert>
      ) : (
        <Alert>{t("profile.noSuggestion")}</Alert>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("profile.name")} htmlFor="pname" required>
          <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("profile.targetTitle")} htmlFor="ptitle" required>
          <Input id="ptitle" value={targetTitle} onChange={(e) => setTargetTitle(e.target.value)} />
        </Field>
        <Field label={t("profile.altTitles")} htmlFor="palt">
          <Input id="palt" value={altTitles} onChange={(e) => setAltTitles(e.target.value)} />
        </Field>
        <Field label={t("profile.seniority")} htmlFor="psen" required>
          <Select
            id="psen"
            value={seniority}
            onChange={(e) => setSeniority(e.target.value as Seniority)}
          >
            {SENIORITIES.map((s) => (
              <option key={s} value={s}>
                {t(`profile.seniorities.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("profile.area")} htmlFor="parea" required>
          <Input id="parea" value={area} onChange={(e) => setArea(e.target.value)} />
        </Field>
        <Field label={t("profile.goal")} htmlFor="pgoal" required>
          <Select id="pgoal" value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
            {GOALS.map((g) => (
              <option key={g} value={g}>
                {t(`profile.goals.${g}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("profile.market")} htmlFor="pmarket" required>
          <Select id="pmarket" value={market} onChange={(e) => setMarket(e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("profile.docLocale")} htmlFor="plocale" required>
          <Select id="plocale" value={docLocale} onChange={(e) => setDocLocale(e.target.value)}>
            <option value="pt-BR">pt-BR</option>
            <option value="en-US">en-US</option>
          </Select>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-semibold">{t("profile.career")}</legend>
        <p className="text-xs text-muted-fg">{t("profile.careerHint")}</p>
        <SalaryRangeInput
          value={salary}
          dontKnow={dontKnow.salary}
          onChange={setSalary}
          onDontKnow={(v) => setDontKnow((d) => ({ ...d, salary: v }))}
          defaultCurrency={info?.currency ?? "BRL"}
        />
        {!dontKnow.salary ? (
          <SalaryReferenceAlert
            salary={salary}
            reference={userCountry === "BR" ? reference : null}
          />
        ) : null}
        <ContractTypes
          value={contractTypes}
          dontKnow={dontKnow.contractTypes}
          onChange={setContractTypes}
          onDontKnow={(v) => setDontKnow((d) => ({ ...d, contractTypes: v }))}
        />
        <LocationsInput
          value={locations}
          dontKnow={dontKnow.locations}
          onChange={setLocations}
          onDontKnow={(v) => setDontKnow((d) => ({ ...d, locations: v }))}
          defaultCountry={userCountry}
        />
        <Field label={t("profile.availableFrom")} required>
          <div className="flex items-center gap-3">
            <Select
              aria-label={t("profile.availableFrom")}
              disabled={dontKnow.availableFrom}
              value={availableMode}
              onChange={(e) => setAvailableMode(e.target.value as "immediate" | "date")}
              className="w-56"
            >
              <option value="immediate">{t("profile.immediate")}</option>
              <option value="date">{t("profile.onDate")}</option>
            </Select>
            {availableMode === "date" ? (
              <Input
                type="date"
                aria-label={t("profile.onDate")}
                disabled={dontKnow.availableFrom}
                value={availableDate}
                onChange={(e) => setAvailableDate(e.target.value)}
                className="w-48"
              />
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={t("app.dontKnow")}
              checked={dontKnow.availableFrom}
              onChange={(e) => setDontKnow((d) => ({ ...d, availableFrom: e.target.checked }))}
            />
            {t("app.dontKnow")}
          </label>
        </Field>
      </fieldset>
      {errors.length > 0 ? (
        <Alert tone="danger">
          {t("review.missingRequired")} {errors.join(", ")}
        </Alert>
      ) : null}
      {externalError ? <Alert tone="danger">{externalError}</Alert> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitLabel ?? t("profile.create")}
        </Button>
      </div>
    </form>
  );
}
