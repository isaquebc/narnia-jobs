import { CLAUDE_MODELS, POSTING_MODEL_KEYS, type PostingModels } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Select } from "../../components/ui/input";
import { type TKey, t } from "../../i18n";

const KEY = ["settings", "models"] as const;

/** Configurações › Modelos (F06-5, F06-13): modelo do Claude por tarefa da análise de vagas. */
export function ModelSettingsSection() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.getModelSettings() });
  const save = useMutation({
    mutationFn: (patch: Partial<PostingModels>) => api.putModelSettings(patch),
    onSuccess: (r) => qc.setQueryData(KEY, r),
  });
  if (!q.data) return null;
  const { models, defaults } = q.data;
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t("models.title")}</h3>
      <p className="text-sm text-muted-fg">{t("models.hint")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {POSTING_MODEL_KEYS.map((k) => (
          <Field
            key={k}
            label={t(`models.${k}` as TKey)}
            htmlFor={`model-${k}`}
            hint={t("models.default", { model: defaults[k] })}
          >
            <Select
              id={`model-${k}`}
              value={models[k]}
              onChange={(e) => save.mutate({ [k]: e.target.value } as Partial<PostingModels>)}
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
      {save.isSuccess ? <Alert tone="ok">{t("models.saved")}</Alert> : null}
    </Card>
  );
}
