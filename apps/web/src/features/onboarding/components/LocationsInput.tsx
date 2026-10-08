import type { RemotePref } from "@narnia-jobs/shared";
import { Button } from "../../../components/ui/button";
import { Field } from "../../../components/ui/field";
import { Input, Select } from "../../../components/ui/input";
import { t } from "../../../i18n";
import { COUNTRIES } from "../countries";
import { DontKnow } from "./DontKnow";

export interface LocationPref {
  country: string;
  city?: string | undefined;
  remote: RemotePref;
}

const REMOTE: RemotePref[] = ["remote", "hybrid", "onsite", "any"];

export function LocationsInput({
  value,
  dontKnow,
  onChange,
  onDontKnow,
  defaultCountry = "BR",
}: {
  value: LocationPref[];
  dontKnow: boolean;
  onChange: (v: LocationPref[]) => void;
  onDontKnow: (v: boolean) => void;
  defaultCountry?: string;
}) {
  const update = (i: number, patch: Partial<LocationPref>) =>
    onChange(value.map((loc, idx) => (idx === i ? { ...loc, ...patch } : loc)));
  return (
    <Field label={t("profile.locations")} required>
      <ul className="flex flex-col gap-2">
        {value.map((loc, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: linhas sem id próprio; a ordem é o identificador
          <li key={`${loc.country}-${i}`} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <Select
              aria-label={t("identity.country")}
              disabled={dontKnow}
              value={loc.country}
              onChange={(e) => update(i, { country: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("profile.locationCity")}
              placeholder={t("profile.locationCity")}
              disabled={dontKnow}
              value={loc.city ?? ""}
              onChange={(e) => update(i, { city: e.target.value || undefined })}
            />
            <Select
              aria-label={t("identity.remotePref")}
              disabled={dontKnow}
              value={loc.remote}
              onChange={(e) => update(i, { remote: e.target.value as RemotePref })}
            >
              {REMOTE.map((r) => (
                <option key={r} value={r}>
                  {t(`identity.remote.${r}`)}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="sm"
              disabled={dontKnow}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
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
          disabled={dontKnow}
          onClick={() => onChange([...value, { country: defaultCountry, remote: "any" }])}
        >
          {t("profile.locationAdd")}
        </Button>
      </div>
      <DontKnow checked={dontKnow} onChange={onDontKnow} />
    </Field>
  );
}
