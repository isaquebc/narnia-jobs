import type { MediaState, RecordingLimits } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CopyButton } from "../../components/ui/copy-button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { t } from "../../i18n";
import { errorText } from "./errors";

export const mediaKeys = {
  status: ["media", "status"] as const,
  limits: ["settings", "recordings"] as const,
};

const TONE: Record<MediaState, "neutral" | "warn" | "ok"> = {
  off: "neutral",
  needs_token: "warn",
  ready: "ok",
};
const MODEL_URL = "https://huggingface.co/pyannote/speaker-diarization-community-1";
const TOKENS_URL = "https://huggingface.co/settings/tokens";
const GB = 1024 ** 3;

const ExternalLink = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="break-all underline">
    {children}
  </a>
);

function TokenForm() {
  const api = useApi();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const id = useId();
  const save = useMutation({
    mutationFn: () => api.putMediaToken(token.trim()),
    onSuccess: (s) => {
      setToken("");
      qc.setQueryData(mediaKeys.status, s);
    },
  });
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) save.mutate();
      }}
    >
      <Field label={t("videoAnalysis.token")} htmlFor={id}>
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => {
            save.reset();
            setToken(e.target.value);
          }}
        />
      </Field>
      {save.isError ? <Alert tone="danger">{errorText(save.error)}</Alert> : null}
      <div>
        <Button type="submit" size="sm" disabled={!token.trim() || save.isPending}>
          {t("videoAnalysis.saveToken")}
        </Button>
      </div>
    </form>
  );
}

function LimitsForm({ limits }: { limits: RecordingLimits }) {
  const api = useApi();
  const qc = useQueryClient();
  const [gb, setGb] = useState(String(+(limits.maxBytes / GB).toFixed(2)));
  const [hours, setHours] = useState(String(+(limits.maxSeconds / 3600).toFixed(2)));
  const save = useMutation({
    mutationFn: (b: RecordingLimits) => api.putRecordingSettings(b),
    onSuccess: (r) => qc.setQueryData(mediaKeys.limits, r),
  });
  const maxBytes = Math.round(Number(gb) * GB);
  const maxSeconds = Math.round(Number(hours) * 3600);
  const valid = maxBytes > 0 && maxSeconds > 0;
  return (
    <section aria-label={t("videoAnalysis.limits")} className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{t("videoAnalysis.limits")}</h4>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("videoAnalysis.maxGb")} htmlFor="recordings-max-gb">
          <Input
            id="recordings-max-gb"
            type="number"
            min={0.1}
            step="any"
            value={gb}
            onChange={(e) => {
              save.reset();
              setGb(e.target.value);
            }}
            className="w-32"
          />
        </Field>
        <Field label={t("videoAnalysis.maxHours")} htmlFor="recordings-max-hours">
          <Input
            id="recordings-max-hours"
            type="number"
            min={0.1}
            step="any"
            value={hours}
            onChange={(e) => {
              save.reset();
              setHours(e.target.value);
            }}
            className="w-32"
          />
        </Field>
        <Button
          type="button"
          size="sm"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate({ maxBytes, maxSeconds })}
        >
          {t("videoAnalysis.saveLimits")}
        </Button>
      </div>
      {save.isSuccess ? (
        <span className="text-sm">{t("videoAnalysis.limitsSaved")}</span>
      ) : save.isError ? (
        <Alert tone="danger">{errorText(save.error)}</Alert>
      ) : null}
    </section>
  );
}

/**
 * Configurações › Análise de vídeo (F13/M1.5; plans/plan-v0/tasks/done/F13 §6.1.1, R2 e R4). O app não liga containers:
 * desligada, mostra o comando do lançador; ligada sem token, o passo a passo do Hugging Face (F13-5); pronta, remover o
 * token. A regra de uso (F13-1) fica sempre visível, e os limites do envio (F13-11) são ajustáveis.
 */
export function VideoAnalysisSection() {
  const api = useApi();
  const qc = useQueryClient();
  const titleId = useId();
  const q = useQuery({ queryKey: mediaKeys.status, queryFn: () => api.getMediaStatus() });
  const limits = useQuery({
    queryKey: mediaKeys.limits,
    queryFn: () => api.getRecordingSettings(),
  });
  const removeToken = useMutation({
    mutationFn: () => api.deleteMediaToken(),
    onSuccess: (s) => qc.setQueryData(mediaKeys.status, s),
  });
  const s = q.data;
  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          {t("videoAnalysis.title")}
        </h3>
        {s ? <Badge tone={TONE[s.state]}>{t(`videoAnalysis.state.${s.state}`)}</Badge> : null}
      </div>
      <p className="text-xs text-muted-fg">{t("videoAnalysis.hint")}</p>
      <Alert tone="warn">{t("videoAnalysis.rule")}</Alert>
      {s?.state === "off" ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>{t("videoAnalysis.offHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 text-xs">{s.enableCommand}</code>
            <CopyButton text={s.enableCommand} />
          </div>
          <p className="text-xs text-muted-fg">{t("videoAnalysis.offSpace")}</p>
        </div>
      ) : null}
      {s?.state === "needs_token" ? (
        <>
          <ol
            aria-label={t("videoAnalysis.steps")}
            className="flex list-decimal flex-col gap-2 pl-5 text-sm"
          >
            <li>{t("videoAnalysis.step1")}</li>
            <li>
              {t("videoAnalysis.step2")}{" "}
              <ExternalLink href={MODEL_URL}>pyannote/speaker-diarization-community-1</ExternalLink>
            </li>
            <li>
              {t("videoAnalysis.step3")} <ExternalLink href={TOKENS_URL}>{TOKENS_URL}</ExternalLink>
            </li>
            <li>{t("videoAnalysis.step4")}</li>
          </ol>
          <TokenForm />
          <p className="text-xs text-muted-fg">{t("videoAnalysis.noToken")}</p>
        </>
      ) : null}
      {s?.state === "ready" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {t("videoAnalysis.readyHint")}
            {s.busy ? ` ${t("videoAnalysis.busy")}` : ""}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removeToken.isPending}
            onClick={() =>
              window.confirm(t("videoAnalysis.removeTokenConfirm")) && removeToken.mutate()
            }
          >
            {t("videoAnalysis.removeToken")}
          </Button>
        </div>
      ) : null}
      {removeToken.isError ? <Alert tone="danger">{errorText(removeToken.error)}</Alert> : null}
      {limits.data ? <LimitsForm limits={limits.data} /> : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          {t("videoAnalysis.refresh")}
        </Button>
      </div>
    </Card>
  );
}
