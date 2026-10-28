import {
  googleCalendarUrl,
  JOB_APPLICATION_EVENT_KINDS,
  type JobApplicationEvent,
  type JobApplicationEventKind,
  type JobApplicationSummary,
} from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Select, Textarea } from "../../components/ui/input";
import { jobApplicationKeys } from "../../hooks/useJobApplications";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";

const kindLabel = (k: JobApplicationEventKind) => t(`jobApplications.agenda.kind.${k}` as TKey);
const appUrl = (id: string) => `${window.location.origin}/candidaturas/${id}`;

function EventItem({ e, stage }: { e: JobApplicationEvent; stage: string | null }) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const done = () => qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
  const patch = useMutation({
    mutationFn: (v: boolean) => api.patchJobApplicationEvent(e.applicationId, e.id, { done: v }),
    onSettled: done,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteJobApplicationEvent(e.applicationId, e.id),
    onSettled: done,
  });
  const late = !e.doneAt && Date.parse(e.startsAt) < Date.now();
  const google = googleCalendarUrl({
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    durationMin: e.durationMin,
    location: e.location,
    link: e.link,
    notes: e.notes,
    sequence: e.icsSequence,
    appUrl: appUrl(e.applicationId),
  });
  const ics = `${api.jobApplicationEventIcsUrl(e.applicationId, e.id)}?origin=${encodeURIComponent(window.location.origin)}`;
  return (
    <li
      className={`flex flex-col gap-1 rounded-md border p-2 text-sm ${late ? "border-warn/60" : "border-border"} ${e.doneAt ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {e.title}
          <span className="font-normal text-muted-fg">
            {" "}
            · {kindLabel(e.kind)}
            {stage ? ` · ${stage}` : ""}
          </span>
        </span>
        <span className="flex gap-1">
          {late ? <Badge tone="warn">{t("jobApplications.agenda.late")}</Badge> : null}
          {e.doneAt ? <Badge tone="ok">{t("jobApplications.agenda.done")}</Badge> : null}
        </span>
      </div>
      {/* hora no fuso da pessoa, com o fuso usado (F07-3) */}
      <span className="text-xs text-muted-fg">
        {formatDate(e.startsAt, tz)} · {tz} ·{" "}
        {t("jobApplications.agenda.minutes", { n: e.durationMin })}
        {e.timezone !== tz
          ? ` · ${t("jobApplications.agenda.registeredIn", { tz: e.timezone })}`
          : ""}
      </span>
      {e.location ? <span className="text-xs">{e.location}</span> : null}
      {e.link ? (
        <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-xs underline">
          {e.link}
        </a>
      ) : null}
      {e.notes ? <p className="whitespace-pre-wrap text-xs">{e.notes}</p> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <a
          href={google}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          {t("jobApplications.agenda.google")}
        </a>
        <a href={ics} download className={buttonClass({ variant: "outline", size: "sm" })}>
          {t("jobApplications.agenda.ics")}
        </a>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={patch.isPending}
          onClick={() => patch.mutate(!e.doneAt)}
        >
          {e.doneAt ? t("jobApplications.agenda.reopen") : t("jobApplications.agenda.complete")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            window.confirm(t("jobApplications.agenda.removeConfirm")) && remove.mutate()
          }
        >
          {t("jobApplications.agenda.remove")}
        </Button>
      </div>
    </li>
  );
}

function NewEvent({ application: a }: { application: JobApplicationSummary }) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const empty = {
    kind: "interview" as JobApplicationEventKind,
    title: "",
    stageId: a.currentStageId ?? "",
    when: "",
    duration: "60",
    location: "",
    link: "",
    notes: "",
  };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api.createJobApplicationEvent(a.id, {
        kind: f.kind,
        title: f.title.trim(),
        stageId: f.stageId || null,
        startsLocal: f.when,
        timezone: tz,
        durationMin: Number(f.duration) || 60,
        location: f.location.trim() || null,
        link: f.link.trim() || null,
        notes: f.notes.trim() || null,
      }),
    onSuccess: () => {
      setF(empty);
      void qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
    },
  });
  const id = (k: string) => `ev-${k}-${a.id}`;
  return (
    <form
      aria-label={t("jobApplications.agenda.new")}
      className="flex flex-col gap-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (f.title.trim() && f.when) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("jobApplications.agenda.kindLabel")} htmlFor={id("kind")}>
          <Select id={id("kind")} value={f.kind} onChange={(e) => set("kind")(e.target.value)}>
            {JOB_APPLICATION_EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("jobApplications.agenda.title")} htmlFor={id("title")}>
          <Input
            id={id("title")}
            value={f.title}
            maxLength={120}
            onChange={(e) => set("title")(e.target.value)}
          />
        </Field>
        <Field label={t("jobApplications.agenda.stage")} htmlFor={id("stage")}>
          <Select
            id={id("stage")}
            value={f.stageId}
            onChange={(e) => set("stageId")(e.target.value)}
          >
            <option value="">{t("jobApplications.agenda.noStage")}</option>
            {a.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.position}. {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("jobApplications.agenda.when")} htmlFor={id("when")}>
          <Input
            id={id("when")}
            type="datetime-local"
            value={f.when}
            onChange={(e) => set("when")(e.target.value)}
          />
        </Field>
        <Field label={t("jobApplications.agenda.duration")} htmlFor={id("duration")}>
          <Input
            id={id("duration")}
            type="number"
            min={5}
            max={1440}
            step={5}
            value={f.duration}
            onChange={(e) => set("duration")(e.target.value)}
          />
        </Field>
        <Field label={t("jobApplications.agenda.location")} htmlFor={id("location")}>
          <Input
            id={id("location")}
            value={f.location}
            onChange={(e) => set("location")(e.target.value)}
          />
        </Field>
        <Field label={t("jobApplications.agenda.link")} htmlFor={id("link")}>
          <Input
            id={id("link")}
            type="url"
            value={f.link}
            onChange={(e) => set("link")(e.target.value)}
          />
        </Field>
      </div>
      <Textarea
        aria-label={t("jobApplications.agenda.notes")}
        placeholder={t("jobApplications.agenda.notes")}
        rows={2}
        value={f.notes}
        onChange={(e) => set("notes")(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-fg">{t("jobApplications.agenda.tzHint", { tz })}</span>
        <Button type="submit" disabled={!f.title.trim() || !f.when || save.isPending}>
          {t("jobApplications.agenda.save")}
        </Button>
      </div>
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
    </form>
  );
}

/**
 * Agenda da candidatura (F07/M5, §2.3): eventos com data e hora no fuso da pessoa (gravados em UTC com o fuso), ligados
 * a uma etapa do pipeline; "Adicionar ao Google Calendar" (link do modelo) e "Baixar .ics", sem conectar conta;
 * concluir tira o evento dos lembretes.
 */
export function AgendaCard({ application: a }: { application: JobApplicationSummary }) {
  const api = useApi();
  const q = useQuery({
    queryKey: [...jobApplicationKeys.detail(a.id), "events"],
    queryFn: () => api.listJobApplicationEvents(a.id),
  });
  const events = q.data?.events ?? [];
  const stageName = (id: string | null) => a.stages.find((s) => s.id === id)?.name ?? null;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("jobApplications.agenda.heading")}</CardTitle>
      {q.isError ? <Alert tone="danger">{describeError(q.error).title}</Alert> : null}
      {q.data && events.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("jobApplications.agenda.empty")}</p>
      ) : null}
      <ul aria-label={t("jobApplications.agenda.list")} className="flex flex-col gap-2">
        {events.map((e) => (
          <EventItem key={e.id} e={e} stage={stageName(e.stageId)} />
        ))}
      </ul>
      <NewEvent application={a} />
    </Card>
  );
}
