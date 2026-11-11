import { RECORDING_EXTENSIONS, type Recording, type RecordingState } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useApi, useTimezone, useWs } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Progress } from "../../components/ui/progress";
import { type TKey, t } from "../../i18n";
import { formatBytes, formatDate } from "../../lib/format";
import { errorText } from "./errors";
import { cancelUpload, clearUpload, startUpload, type UploadState, useUploads } from "./uploads";
import { mediaKeys } from "./VideoAnalysisSection";

interface Stage {
  id: string;
  name: string;
}
/** Candidatura dona das entrevistas (envio na etapa) ou só o perfil (envio avulso, F13-3). */
export type RecordingsOwner =
  | { application: { id: string; stages: Stage[]; currentStageId: string | null } }
  | { profileId: string };

const ACCEPT = RECORDING_EXTENSIONS.map((e) => `.${e}`).join(",");
const TONE: Record<RecordingState, "neutral" | "warn" | "ok" | "danger"> = {
  uploading: "warn",
  uploaded: "neutral",
  analyzing: "warn",
  ready: "ok",
  failed: "danger",
};

export const recordingKeys = {
  all: ["recordings"] as const,
  list: (owner: RecordingsOwner) =>
    [
      "recordings",
      "application" in owner ? { jobApplicationId: owner.application.id } : owner,
    ] as const,
};

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: recordingKeys.all });
}

function MediaNotice() {
  const api = useApi();
  const q = useQuery({ queryKey: mediaKeys.status, queryFn: () => api.getMediaStatus() });
  const state = q.data?.state;
  if (!state || state === "ready") return null;
  return (
    <Alert tone="info">
      {state === "off" ? t("recordings.off") : t("recordings.needsToken")}{" "}
      <NavLink to="/configuracoes" className="underline">
        {t("recordings.settingsLink")}
      </NavLink>
      .
    </Alert>
  );
}

function UploadForm({ owner }: { owner: RecordingsOwner }) {
  const api = useApi();
  const refresh = useRefresh();
  const app = "application" in owner ? owner.application : null;
  const [stageId, setStageId] = useState(app?.currentStageId ?? "");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const ids = { stage: useId(), title: useId(), file: useId() };
  const create = useMutation({
    mutationFn: (f: File) =>
      api.createRecording({
        ...(app
          ? { jobApplicationId: app.id, ...(stageId ? { stageId } : {}) }
          : { profileId: (owner as { profileId: string }).profileId }),
        ...(title.trim() ? { title: title.trim() } : {}),
        fileName: f.name,
        size: f.size,
        mime: f.type || "application/octet-stream",
      }),
    onSuccess: (rec, f) => {
      startUpload(api, rec, f, refresh);
      setFile(null);
      setTitle("");
      setInputKey((k) => k + 1);
      refresh();
    },
  });
  return (
    <form
      aria-label={t("recordings.form")}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) create.mutate(file);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {app ? (
          <Field label={t("recordings.stage")} htmlFor={ids.stage}>
            <select
              id={ids.stage}
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="h-10 w-48 rounded-md border border-border bg-card px-2 text-sm"
            >
              <option value="">{t("recordings.noStage")}</option>
              {app.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={t("recordings.titleField")} htmlFor={ids.title}>
          <Input
            id={ids.title}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className="w-56"
          />
        </Field>
        <Field label={t("recordings.file")} htmlFor={ids.file}>
          <input
            key={inputKey}
            id={ids.file}
            type="file"
            accept={ACCEPT}
            className="text-sm"
            onChange={(e) => {
              create.reset();
              setFile(e.target.files?.[0] ?? null);
            }}
          />
        </Field>
        <Button type="submit" disabled={!file || create.isPending}>
          {t("recordings.send")}
        </Button>
      </div>
      <p className="text-xs text-muted-fg">{t("recordings.tip")}</p>
      {create.isError ? <Alert tone="danger">{errorText(create.error)}</Alert> : null}
    </form>
  );
}

function Uploading({ up, onCancel }: { up: UploadState; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <Progress
        value={(up.received / up.size) * 100}
        label={t("recordings.progress", { name: up.fileName })}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-fg">
        <span>
          {t("recordings.sent", { sent: formatBytes(up.received), total: formatBytes(up.size) })}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("recordings.cancel")}
        </Button>
      </div>
    </div>
  );
}

function Resume({ rec, error }: { rec: Recording; error: string | null }) {
  const api = useApi();
  const refresh = useRefresh();
  const name = rec.title ?? rec.fileName;
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        {t("recordings.stopped", {
          pct: Math.floor((rec.received / rec.size) * 100),
          sent: formatBytes(rec.received),
          total: formatBytes(rec.size),
        })}
      </p>
      <label htmlFor={id} className="sr-only">
        {t("recordings.resume", { name })}
      </label>
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        className="text-sm"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) startUpload(api, rec, f, refresh);
        }}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

const duration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
};

function RecordingItem({
  rec,
  stages,
  up,
  showApplication,
}: {
  rec: Recording;
  stages: Stage[];
  up: UploadState | undefined;
  showApplication: boolean;
}) {
  const api = useApi();
  const tz = useTimezone();
  const refresh = useRefresh();
  const removeVideo = useMutation({
    mutationFn: () => api.deleteRecordingVideo(rec.id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => {
      cancelUpload(rec.id);
      return api.deleteRecording(rec.id);
    },
    onSuccess: () => {
      clearUpload(rec.id);
      refresh();
    },
  });
  const name = rec.title ?? rec.fileName;
  const stage = stages.find((s) => s.id === rec.stageId)?.name;
  const sending = up && !up.done && !up.error;
  const meta = [
    stage,
    showApplication && rec.jobApplicationId ? t("recordings.application") : null,
    formatDate(rec.createdAt, tz),
    formatBytes(rec.size),
    rec.durationS !== null ? duration(rec.durationS) : null,
  ].filter(Boolean);
  const error = removeVideo.error ?? remove.error;
  return (
    <li aria-label={name} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-fg">{meta.join(" · ")}</span>
        </div>
        <Badge tone={TONE[rec.state]}>{t(`recordings.state.${rec.state}`)}</Badge>
      </div>
      {sending ? (
        <Uploading
          up={up}
          onCancel={() => window.confirm(t("recordings.cancelConfirm")) && remove.mutate()}
        />
      ) : rec.state === "uploading" ? (
        <Resume rec={rec} error={up?.error ?? null} />
      ) : null}
      {rec.hasVideo ? (
        // biome-ignore lint/a11y/useMediaCaption: gravação da pessoa, sem legenda (a transcrição vem com a análise)
        <video
          src={api.recordingVideoUrl(rec.id)}
          controls
          preload="metadata"
          className="max-h-72 w-full rounded bg-black"
        />
      ) : rec.state !== "uploading" && !rec.error ? (
        <p className="text-xs text-muted-fg">{t("recordings.videoRemoved")}</p>
      ) : null}
      {rec.error && rec.state === "failed" ? <Alert tone="danger">{rec.error}</Alert> : null}
      {rec.state === "analyzing" ? (
        <Progress
          value={rec.progress}
          label={t("recordingPage.analyzing", {
            step: rec.step ? t(`recordingPage.steps.${rec.step}` as TKey) : "",
            pct: rec.progress,
          })}
        />
      ) : null}
      {rec.state !== "uploading" ? (
        <NavLink to={`/entrevistas/${rec.id}`} className="text-sm underline">
          {t("recordingPage.open")}
        </NavLink>
      ) : null}
      {sending ? null : (
        <div className="flex flex-wrap gap-1">
          {rec.hasVideo ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removeVideo.isPending}
              onClick={() =>
                window.confirm(t("recordings.removeVideoConfirm")) && removeVideo.mutate()
              }
            >
              {t("recordings.removeVideo")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => window.confirm(t("recordings.removeConfirm")) && remove.mutate()}
          >
            {t("recordings.remove")}
          </Button>
        </div>
      )}
      {error ? <Alert tone="danger">{errorText(error)}</Alert> : null}
    </li>
  );
}

/**
 * Entrevistas gravadas (F13/M1.5; plans/plan-v0/tasks/done/F13 §6.1.1, R5 e R6): na página da candidatura, com a etapa; na
 * aba Entrevistas do perfil, avulsa. O envio vai em partes e continua ao trocar de página; se a aba fechar, retoma
 * escolhendo o mesmo arquivo. Reprodução com avanço pelo player; apagar só o vídeo ou a entrevista inteira (F13-2).
 */
function useRecordingsEvents() {
  const ws = useWs();
  const qc = useQueryClient();
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "recording.updated")
        void qc.invalidateQueries({ queryKey: recordingKeys.all });
    });
  }, [ws, qc]);
}

export function RecordingsCard(owner: RecordingsOwner) {
  const api = useApi();
  useRecordingsEvents();
  const titleId = useId();
  const uploads = useUploads();
  const app = "application" in owner ? owner.application : null;
  const q = useQuery({
    queryKey: recordingKeys.list(owner),
    queryFn: () =>
      api.listRecordings(
        app
          ? { jobApplicationId: app.id }
          : { profileId: (owner as { profileId: string }).profileId },
      ),
  });
  const items = q.data?.recordings ?? [];
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-3">
      <CardTitle id={titleId}>{t("recordings.title")}</CardTitle>
      <p className="text-xs text-muted-fg">{t("recordings.hint")}</p>
      <MediaNotice />
      <UploadForm owner={owner} />
      {q.isError ? <Alert tone="danger">{errorText(q.error)}</Alert> : null}
      {q.data && items.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("recordings.empty")}</p>
      ) : null}
      <ul
        aria-label={app ? t("recordings.list") : t("recordings.listProfile")}
        className="flex flex-col gap-3"
      >
        {items.map((r) => (
          <RecordingItem
            key={r.id}
            rec={r}
            stages={app?.stages ?? []}
            up={uploads.find((u) => u.recordingId === r.id)}
            showApplication={!app}
          />
        ))}
      </ul>
    </Card>
  );
}
