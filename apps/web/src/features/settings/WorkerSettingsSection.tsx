import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Select } from "../../components/ui/input";
import { type TKey, t } from "../../i18n";
import type { WorkerSettings } from "../../lib/api";

/** Configurações › Processos simultâneos (F05 M7): jobs por fila, de 1 a 4; o worker aplica sem reiniciar. */
const QUEUES = ["ingest", "ocr", "extract"] as const;

export function WorkerSettingsSection() {
  const api = useApi();
  const qc = useQueryClient();
  const ids = useId();
  const q = useQuery({ queryKey: ["settings", "workers"], queryFn: () => api.getWorkerSettings() });
  const save = useMutation({
    mutationFn: (patch: Partial<WorkerSettings["concurrency"]>) => api.putWorkerSettings(patch),
    onSuccess: (data) => qc.setQueryData(["settings", "workers"], data),
  });
  const s = q.data;
  return (
    <Card className="flex flex-col gap-3" aria-label={t("processes.settings")}>
      <h3 className="text-sm font-semibold">{t("processes.settings")}</h3>
      <p className="text-sm text-muted-fg">{t("processes.settingsHint")}</p>
      {s ? (
        <div className="flex flex-wrap gap-4">
          {QUEUES.map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-${k}`}>
              {t(`processes.queues.${k}` as TKey)}
              <Select
                id={`${ids}-${k}`}
                className="h-9 w-24"
                value={s.concurrency[k]}
                onChange={(e) => save.mutate({ [k]: Number(e.target.value) })}
              >
                {Array.from({ length: s.max - s.min + 1 }, (_, i) => s.min + i).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-fg">
                {t("processes.default", { n: s.defaults[k] })}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {save.isSuccess ? <Alert tone="ok">{t("processes.saved")}</Alert> : null}
    </Card>
  );
}
