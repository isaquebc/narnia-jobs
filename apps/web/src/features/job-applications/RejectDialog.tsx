import type { JobApplicationSummary } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Input, Select, Textarea } from "../../components/ui/input";
import { jobApplicationKeys } from "../../hooks/useJobApplications";
import { t } from "../../i18n";
import { todayIn } from "./ApplyButton";

/**
 * Desclassificação (pedido do dono, 2026-10-29): a pessoa cola o e-mail ("o processo foi finalizado", "você não seguiu
 * na etapa X"), escolhe a etapa (a atual por padrão, ou sem etapa) e a data. O texto vira nota datada (decisão do dono)
 * e a candidatura vai para Encerrado como não aprovada.
 */
export function RejectButton({ application: a }: { application: JobApplicationSummary }) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const today = todayIn(tz);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [stageId, setStageId] = useState(a.currentStageId ?? "");
  const [date, setDate] = useState(today);
  const reject = useMutation({
    mutationFn: () =>
      api.rejectJobApplication(a.id, {
        occurredOn: date,
        message: message.trim(),
        stageId: stageId || null,
      }),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
    },
  });
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("jobApplications.rejection.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t("jobApplications.rejection.title")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim()) reject.mutate();
          }}
        >
          <Field label={t("jobApplications.rejection.message")} htmlFor="reject-message" required>
            <Textarea
              id="reject-message"
              rows={8}
              value={message}
              placeholder={t("jobApplications.rejection.placeholder")}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <Field label={t("jobApplications.rejection.stage")} htmlFor="reject-stage">
            <Select id="reject-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">{t("jobApplications.rejection.noStage")}</option>
              {a.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("jobApplications.rejection.date")} htmlFor="reject-date">
            <Input
              id="reject-date"
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-fg">{t("jobApplications.rejection.hint")}</p>
          <div className="flex justify-end">
            <Button type="submit" disabled={!message.trim() || !date || reject.isPending}>
              {t("jobApplications.rejection.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
