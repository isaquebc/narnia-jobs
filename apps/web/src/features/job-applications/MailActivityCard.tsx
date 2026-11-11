import type { JobApplicationSummary } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Select } from "../../components/ui/input";
import { jobApplicationKeys } from "../../hooks/useJobApplications";
import { type TKey, t } from "../../i18n";
import type { MailActivity } from "../../lib/api";
import { formatDate } from "../../lib/format";

const activityKey = (id: string) => ["job-applications", id, "mail-activity"] as const;

function Suggestion({
  s,
  application: a,
  refresh,
}: {
  s: MailActivity["suggestions"][number];
  application: JobApplicationSummary;
  refresh: () => void;
}) {
  const api = useApi();
  const [stageId, setStageId] = useState(s.toStageId ?? "");
  const approve = useMutation({
    mutationFn: () => api.approveStageSuggestion(s.id, stageId || undefined),
    onSettled: refresh,
  });
  const failed = approve.error ?? null;
  const reject = useMutation({
    mutationFn: () => api.rejectStageSuggestion(s.id),
    onSettled: refresh,
  });
  return (
    <li className="flex flex-col gap-2 rounded-md border border-primary/40 p-2 text-sm">
      <span>
        {s.toStageId
          ? t("jobApplications.mail.suggestion", { stage: s.toStageName })
          : t("jobApplications.mail.suggestionNoMatch", { hint: s.hint ?? s.toStageName })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("jobApplications.mail.stage")}
          value={stageId}
          onChange={(e) => setStageId(e.target.value)}
          className="w-auto"
        >
          <option value="">{t("jobApplications.mail.chooseStage")}</option>
          {a.stages.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={!stageId || approve.isPending} onClick={() => approve.mutate()}>
          {t("jobApplications.mail.approve")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={reject.isPending}
          onClick={() => reject.mutate()}
        >
          {t("jobApplications.mail.reject")}
        </Button>
      </div>
      {failed || reject.error ? (
        <Alert tone="danger">{describeError(failed ?? reject.error).title}</Alert>
      ) : null}
    </li>
  );
}

/**
 * Pelo e-mail (F14/M6): sugestões de etapa para aprovar, os e-mails que mexeram na candidatura (cada um com
 * "desfazer") e o histórico das etapas com a origem de cada mudança.
 */
export function MailActivityCard({ application: a }: { application: JobApplicationSummary }) {
  const api = useApi();
  const tz = useTimezone();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: activityKey(a.id), queryFn: () => api.getMailActivity(a.id) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: activityKey(a.id) });
    void qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
  };
  const undo = useMutation({
    mutationFn: (mailId: string) => api.undoMail(mailId),
    onSuccess: (r) => {
      if (r.applicationRemoved) void navigate({ to: "/candidaturas" });
      else refresh();
    },
    onError: refresh,
  });
  const d = q.data;
  if (!d || (!d.mails.length && !d.suggestions.length && !d.stageChanges.length)) return null;
  return (
    <Card
      role="region"
      aria-label={t("jobApplications.mail.heading")}
      className="flex flex-col gap-3"
    >
      <CardTitle>{t("jobApplications.mail.heading")}</CardTitle>
      {d.suggestions.length ? (
        <ul aria-label={t("jobApplications.mail.suggestions")} className="flex flex-col gap-2">
          {d.suggestions.map((s) => (
            <Suggestion key={s.id} s={s} application={a} refresh={refresh} />
          ))}
        </ul>
      ) : null}
      {d.mails.length ? (
        <ul aria-label={t("jobApplications.mail.mails")} className="flex flex-col gap-1">
          {d.mails.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className={m.undoneAt ? "line-through opacity-70" : ""}>
                {m.class ? t(`mailReview.class.${m.class}` as TKey) : null} · {m.subject ?? ""}
              </span>
              <span className="text-xs text-muted-fg">
                {m.from} · {formatDate(m.receivedAt, tz)}
              </span>
              {m.undoneAt ? <Badge>{t("jobApplications.mail.undone")}</Badge> : null}
              <a
                href={m.mailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline"
              >
                {t("mailReview.openGmail")}
              </a>
              {m.canUndo ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={undo.isPending}
                  onClick={() =>
                    window.confirm(t("jobApplications.mail.undoConfirm")) && undo.mutate(m.id)
                  }
                >
                  {t("jobApplications.mail.undo")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {undo.error ? <Alert tone="danger">{describeError(undo.error).title}</Alert> : null}
      {undo.data?.skipped?.length ? (
        <Alert tone="warn">
          {t("jobApplications.mail.skipped", { list: undo.data.skipped.join("; ") })}
        </Alert>
      ) : null}
      {d.stageChanges.length ? (
        <ul aria-label={t("jobApplications.mail.history")} className="flex flex-col gap-1 text-xs">
          {d.stageChanges.map((c) => (
            <li key={c.id}>
              {formatDate(c.at, tz)} · {c.fromStageName ?? "—"} → {c.toStageName ?? "—"} ·{" "}
              {t(`jobApplications.mail.source.${c.source}` as TKey)}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
