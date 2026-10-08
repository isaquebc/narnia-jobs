import { useEffect, useState } from "react";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Select } from "../../components/ui/input";
import { useAnalyzeProfiles } from "../../hooks/useSuggestions";
import { t } from "../../i18n";
import { formatTokens } from "../../lib/format";
import { profileErrorMessage } from "./profile-errors";

const MODELS = ["haiku", "sonnet", "opus"] as const;

/** "Analisar possíveis perfis" (F02-5): operação cara, então estimativa e confirmação antes do job. */
export function AnalyzeProfilesDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStarted: () => void;
}) {
  const { estimate, run } = useAnalyzeProfiles();
  const [model, setModel] = useState<string>("sonnet");
  const { refetch } = estimate;
  const { reset } = run;
  useEffect(() => {
    if (open) {
      reset();
      void refetch();
    }
  }, [open, reset, refetch]);
  useEffect(() => {
    if (estimate.data?.model) setModel(estimate.data.model);
  }, [estimate.data?.model]);

  function confirm() {
    run.mutate(
      { model },
      {
        onSuccess: () => {
          onOpenChange(false);
          onStarted();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("profiles.analyze.title")}>
      <div className="flex flex-col gap-4">
        <Alert tone="warn">{t("profiles.analyze.warning")}</Alert>
        <p className="text-sm" aria-live="polite">
          {estimate.data
            ? t("profiles.analyze.estimate", {
                tokens: formatTokens(estimate.data.tokens),
                model: estimate.data.model,
              })
            : t("profiles.analyze.estimating")}
        </p>
        <Field label={t("profiles.analyze.model")} htmlFor="analyze-model">
          <Select id="analyze-model" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        {run.isError ? <Alert tone="danger">{profileErrorMessage(run.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("app.cancel")}
          </Button>
          <Button onClick={confirm} disabled={run.isPending || !estimate.data}>
            {t("profiles.analyze.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
