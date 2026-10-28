import {
  ATTACHMENT_MAX_BYTES,
  type JobApplicationAttachment,
  type JobApplicationEntry,
} from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Textarea } from "../../components/ui/input";
import { jobApplicationKeys } from "../../hooks/useJobApplications";
import { t } from "../../i18n";
import { formatBytes, formatDate } from "../../lib/format";
import { todayIn } from "./ApplyButton";

function Attachment({ appId, a }: { appId: string; a: JobApplicationAttachment }) {
  const api = useApi();
  const url = api.jobApplicationAttachmentUrl(appId, a.id);
  const label = `${a.fileName} · ${formatBytes(a.size)}`;
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(a.mime))
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={label}>
        <img src={url} alt={a.fileName} className="max-h-48 rounded border border-border" />
      </a>
    );
  if (a.mime.startsWith("video/"))
    return (
      <figure className="flex flex-col gap-1">
        {/* biome-ignore lint/a11y/useMediaCaption: gravação da pessoa, sem legenda */}
        <video src={url} controls preload="metadata" className="max-h-64 rounded" />
        <figcaption className="text-xs text-muted-fg">{label}</figcaption>
      </figure>
    );
  if (a.mime.startsWith("audio/"))
    return (
      <figure className="flex flex-col gap-1">
        {/* biome-ignore lint/a11y/useMediaCaption: gravação da pessoa, sem legenda */}
        <audio src={url} controls preload="metadata" />
        <figcaption className="text-xs text-muted-fg">{label}</figcaption>
      </figure>
    );
  if (a.mime === "application/pdf" || a.mime === "text/plain")
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
        {t("jobApplications.entries.open", { name: label })}
      </a>
    );
  return (
    <a href={url} download={a.fileName} className="text-sm underline">
      {t("jobApplications.entries.download", { name: label })}
    </a>
  );
}

const tooBig = (files: File[]) => files.some((f) => f.size > ATTACHMENT_MAX_BYTES);

function NewEntry({ appId, onSaved }: { appId: string; onSaved: () => void }) {
  const api = useApi();
  const tz = useTimezone();
  const today = todayIn(tz);
  const [body, setBody] = useState("");
  const [date, setDate] = useState(today);
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const save = useMutation({
    mutationFn: () =>
      api.createJobApplicationEntry(appId, { occurredOn: date, body: body.trim() || null, files }),
    onSuccess: () => {
      setBody("");
      setFiles([]);
      setDate(today);
      setInputKey((k) => k + 1);
      onSaved();
    },
  });
  const big = tooBig(files);
  const empty = !body.trim() && files.length === 0;
  return (
    <form
      aria-label={t("jobApplications.entries.new")}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty && !big && date) save.mutate();
      }}
    >
      <Textarea
        aria-label={t("jobApplications.entries.body")}
        placeholder={t("jobApplications.entries.bodyPlaceholder")}
        rows={3}
        value={body}
        maxLength={20_000}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("jobApplications.entries.date")} htmlFor={`entry-date-${appId}`}>
          <Input
            id={`entry-date-${appId}`}
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </Field>
        <Field label={t("jobApplications.entries.files")} htmlFor={`entry-files-${appId}`}>
          <input
            key={inputKey}
            id={`entry-files-${appId}`}
            type="file"
            multiple
            className="text-sm"
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
        </Field>
        <Button type="submit" disabled={empty || big || !date || save.isPending}>
          {t("jobApplications.entries.save")}
        </Button>
      </div>
      {big ? <Alert tone="warn">{t("jobApplications.entries.tooBig")}</Alert> : null}
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
    </form>
  );
}

function EntryItem({ e, onChanged }: { e: JobApplicationEntry; onChanged: () => void }) {
  const api = useApi();
  const tz = useTimezone();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(e.body ?? "");
  const [date, setDate] = useState(e.occurredOn);
  const patch = useMutation({
    mutationFn: () =>
      api.patchJobApplicationEntry(e.applicationId, e.id, {
        body: body.trim() || null,
        occurredOn: date,
      }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteJobApplicationEntry(e.applicationId, e.id),
    onSuccess: onChanged,
  });
  const error = patch.error ?? remove.error;
  return (
    <li className="flex flex-col gap-2 border-b border-border pb-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-fg">{formatDate(e.occurredOn, tz)}</span>
        {editing ? null : (
          <span className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("jobApplications.entries.edit")}
              onClick={() => setEditing(true)}
            >
              {t("jobApplications.entries.editShort")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("jobApplications.entries.remove")}
              onClick={() =>
                window.confirm(t("jobApplications.entries.removeConfirm")) && remove.mutate()
              }
            >
              {t("jobApplications.entries.removeShort")}
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            patch.mutate();
          }}
        >
          <Textarea
            aria-label={t("jobApplications.entries.body")}
            rows={3}
            value={body}
            onChange={(ev) => setBody(ev.target.value)}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("jobApplications.entries.date")} htmlFor={`edit-date-${e.id}`}>
              <Input
                id={`edit-date-${e.id}`}
                type="date"
                max={todayIn(tz)}
                value={date}
                onChange={(ev) => setDate(ev.target.value)}
                className="w-44"
              />
            </Field>
            <Button type="submit" size="sm" disabled={!date || patch.isPending}>
              {t("jobApplications.entries.saveEdit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setBody(e.body ?? "");
                setDate(e.occurredOn);
              }}
            >
              {t("jobApplications.entries.cancel")}
            </Button>
          </div>
        </form>
      ) : e.body ? (
        <p className="whitespace-pre-wrap text-sm">{e.body}</p>
      ) : null}
      {e.attachments.length > 0 ? (
        <div className="flex flex-wrap items-start gap-3">
          {e.attachments.map((a) => (
            <Attachment key={a.id} appId={e.applicationId} a={a} />
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="danger">{describeError(error).title}</Alert> : null}
    </li>
  );
}

/**
 * Notas e anexos datados da candidatura (F07/M3, §0-5): texto e/ou arquivos (e-mail, imagem, PDF, vídeo…) com a data
 * que a pessoa escolhe antes de salvar (ex.: um e-mail de ontem). Imagem, vídeo e áudio com prévia; PDF e texto abrem
 * em outra aba; o resto baixa. Até 100 MB por arquivo (F07-11).
 */
export function EntriesCard({ appId }: { appId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const key = [...jobApplicationKeys.detail(appId), "entries"] as const;
  const q = useQuery({ queryKey: key, queryFn: () => api.listJobApplicationEntries(appId) });
  const changed = () => void qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
  const entries = q.data?.entries ?? [];
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("jobApplications.entries.title")}</CardTitle>
      <NewEntry appId={appId} onSaved={changed} />
      {q.isError ? <Alert tone="danger">{describeError(q.error).title}</Alert> : null}
      {q.data && entries.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("jobApplications.entries.empty")}</p>
      ) : null}
      <ul aria-label={t("jobApplications.entries.list")} className="flex flex-col gap-3">
        {entries.map((e) => (
          <EntryItem key={`${e.id}:${e.updatedAt}`} e={e} onChanged={changed} />
        ))}
      </ul>
    </Card>
  );
}
