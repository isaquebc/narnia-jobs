import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "../../app/context";
import { useFormGuard } from "../../app/FormGuard";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Textarea } from "../../components/ui/input";
import { profileCardKey } from "../../hooks/useProfileCard";
import { profileKey, profilesKey } from "../../hooks/useProfiles";
import { t } from "../../i18n";
import type { ProfileRecord } from "../../lib/api";

/** Aba Narrativa (F02 §4): pitch de 3–5 linhas, contador, prévia de como entra no cartão. */
export function PitchEditor({ profile }: { profile: ProfileRecord }) {
  const api = useApi();
  const qc = useQueryClient();
  const guard = useFormGuard();
  const [pitch, setPitch] = useState(profile.pitch ?? "");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.patchProfile(profile.id, { pitch }),
    onSuccess: async () => {
      setSaved(true);
      guard.setDirty(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: profileKey(profile.id) }),
        qc.invalidateQueries({ queryKey: profileCardKey(profile.id) }),
        qc.invalidateQueries({ queryKey: profilesKey }),
      ]);
    },
  });
  const lines = pitch.length === 0 ? 0 : pitch.split("\n").length;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("pitch.title")}</CardTitle>
      <p className="text-sm text-muted-fg">{t("pitch.hint")}</p>
      <Field label={t("pitch.label")} htmlFor="pitch">
        <Textarea
          id="pitch"
          rows={5}
          value={pitch}
          onChange={(e) => {
            setPitch(e.target.value);
            setSaved(false);
            guard.setDirty(true);
          }}
        />
      </Field>
      <p className="text-xs text-muted-fg">{t("pitch.counter", { count: pitch.length, lines })}</p>
      <div>
        <p className="text-xs uppercase text-muted-fg">{t("pitch.inCard")}</p>
        <p className="whitespace-pre-wrap font-mono text-xs">{pitch || t("pitch.empty")}</p>
      </div>
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
      {saved ? <Alert tone="ok">{t("pitch.saved")}</Alert> : null}
      <div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {t("pitch.save")}
        </Button>
      </div>
    </Card>
  );
}
