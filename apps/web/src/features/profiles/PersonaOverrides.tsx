import type { PersonaOverrides as Overrides, Persona } from "@narnia-jobs/shared";
import { useEffect, useState } from "react";
import { describeError, ErrorState } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Select } from "../../components/ui/input";
import { usePersona } from "../../hooks/usePersona";
import { type TKey, t } from "../../i18n";

type EnumField = "tone" | "honesty" | "rigor" | "recruiterSeniority";
const ENUMS: Record<EnumField, { options: readonly string[]; labels: string }> = {
  tone: { options: ["direto", "cordial"], labels: "persona.tones" },
  honesty: { options: ["maxima", "diplomatica"], labels: "persona.honesties" },
  rigor: { options: ["alto", "medio"], labels: "persona.rigors" },
  recruiterSeniority: { options: ["senior", "pleno"], labels: "persona.recruiterSeniorities" },
};
type TextField = "specialty" | "market";

/** Aba Recrutador (F02 §4, F02-7): persona derivada, seletores com padrão e restaurar por campo. */
export function PersonaOverrides({ profileId }: { profileId: string }) {
  const { data, isError, error, refetch, save } = usePersona(profileId);
  const [local, setLocal] = useState<Overrides>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) setLocal(data.overrides);
  }, [data]);
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;

  const effective = (field: keyof Persona): string => {
    const v = local[field as keyof Overrides];
    return v === null || v === undefined ? String(data.defaults[field]) : String(v);
  };
  const overridden = (field: keyof Overrides) =>
    local[field] !== undefined && local[field] !== null;
  const setField = (field: keyof Overrides, value: string | null) => {
    setSaved(false);
    setLocal((o) => ({ ...o, [field]: value }));
  };
  const restore = (field: keyof Overrides) => {
    const next = { ...local, [field]: null };
    setLocal(next);
    save.mutate(next, { onSuccess: () => setSaved(true) });
  };
  const restoreButton = (field: keyof Overrides, label: string) =>
    overridden(field) ? (
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${t("persona.restore")} ${label}`}
        onClick={() => restore(field)}
      >
        {t("persona.restore")}
      </Button>
    ) : null;

  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>{t("persona.title")}</CardTitle>
      <p className="text-sm text-muted-fg">{t("persona.hint")}</p>
      <div className="rounded-md border border-border p-3 text-sm">
        <p className="text-xs uppercase text-muted-fg">{t("persona.preview")}</p>
        <p>
          {data.persona.specialty} · {t(`profile.seniorities.${data.persona.targetLevel}`)} ·{" "}
          {data.persona.market} · {data.persona.language} ·{" "}
          {t(`persona.tones.${data.persona.tone}`)} ·{" "}
          {t(`persona.honesties.${data.persona.honesty}`)} ·{" "}
          {t(`persona.rigors.${data.persona.rigor}`)} ·{" "}
          {t(`persona.recruiterSeniorities.${data.persona.recruiterSeniority}`)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(["specialty", "market"] as TextField[]).map((field) => (
          <Field
            key={field}
            label={t(`persona.${field}`)}
            htmlFor={`persona-${field}`}
            hint={
              <span className="flex items-center gap-2">
                {overridden(field) ? <Badge tone="info">{t("persona.overridden")}</Badge> : null}
                {restoreButton(field, t(`persona.${field}`))}
              </span>
            }
          >
            <Input
              id={`persona-${field}`}
              value={effective(field)}
              onChange={(e) => setField(field, e.target.value)}
            />
          </Field>
        ))}
        <Field
          label={t("persona.language")}
          htmlFor="persona-language"
          hint={restoreButton("language", t("persona.language"))}
        >
          <Select
            id="persona-language"
            value={effective("language")}
            onChange={(e) => setField("language", e.target.value)}
          >
            <option value="pt-BR">pt-BR</option>
            <option value="en-US">en-US</option>
          </Select>
        </Field>
        {(Object.keys(ENUMS) as EnumField[]).map((field) => (
          <Field
            key={field}
            label={t(`persona.${field}`)}
            htmlFor={`persona-${field}`}
            hint={
              <span className="flex items-center gap-2">
                {overridden(field) ? <Badge tone="info">{t("persona.overridden")}</Badge> : null}
                {restoreButton(field, t(`persona.${field}`))}
              </span>
            }
          >
            <Select
              id={`persona-${field}`}
              value={effective(field)}
              onChange={(e) => setField(field, e.target.value)}
            >
              {ENUMS[field].options.map((o) => (
                <option key={o} value={o}>
                  {t(`${ENUMS[field].labels}.${o}` as TKey)}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
      {saved ? <Alert tone="ok">{t("persona.saved")}</Alert> : null}
      <div>
        <Button
          onClick={() => save.mutate(local, { onSuccess: () => setSaved(true) })}
          disabled={save.isPending}
        >
          {t("persona.save")}
        </Button>
      </div>
    </Card>
  );
}
