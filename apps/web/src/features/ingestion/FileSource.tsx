import type { FileResponse, IngestionCreateRequest } from "@narnia-jobs/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { FileDropzone } from "../onboarding/components/FileDropzone";
import { FreeTextEditor, TEXT_MIN } from "../onboarding/components/FreeTextEditor";
import { EstimateCard } from "./EstimateCard";

/** Aviso de conteúdo já lido (F03, hash do arquivo/texto): abre a execução anterior ou lê de novo. */
export function AlreadyReadNotice({
  file,
  onReadAgain,
}: {
  file: FileResponse;
  onReadAgain: () => void;
}) {
  const tz = useTimezone();
  const last = (file.previousRuns ?? []).at(-1);
  if (!last) return null;
  return (
    <Alert tone="warn" className="flex flex-col gap-2">
      <span>{t("fileSource.alreadyRead", { date: formatDate(last.createdAt, tz) })}</span>
      <div className="flex gap-2">
        <NavLink
          to={`/ingestao/${last.runId}`}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
        >
          {t("fileSource.openPrevious")}
        </NavLink>
        <Button size="sm" onClick={onReadAgain}>
          {t("fileSource.readAgain")}
        </Button>
      </div>
    </Alert>
  );
}

/**
 * CV adicional ou texto livre (F03 §4): reaproveita o envio do F01, avisa quando o conteúdo já foi lido, mostra a
 * estimativa e segue sozinho abaixo do limiar de autoconfirmação (F03-13); acima dele espera "Extrair".
 */
export function FileSource({ kind }: { kind: "cv" | "text" }) {
  const api = useApi();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [uploaded, setUploaded] = useState<FileResponse | null>(null);
  const [readAgain, setReadAgain] = useState(false);
  const started = useRef(false);

  const upload = useMutation({
    mutationFn: (input: File | string) =>
      typeof input === "string" ? api.createText(input) : api.uploadFile(input),
    onSuccess: (f) => {
      setUploaded(f);
      setReadAgain(false);
      started.current = false;
    },
  });

  const seen = (uploaded?.previousRuns ?? []).length > 0;
  const ready = Boolean(uploaded) && (!seen || readAgain);

  const estimate = useQuery({
    queryKey: ["ingestion", "estimate", "file", uploaded?.id],
    queryFn: () => api.estimateIngestion({ source: kind, fileId: uploaded?.id as string }),
    enabled: ready,
  });

  const start = useMutation({
    mutationFn: () => api.createIngestion({ fileId: uploaded?.id } as IngestionCreateRequest),
    onSuccess: (run) => navigate({ to: "/ingestao/$runId", params: { runId: run.id } }),
  });

  useEffect(() => {
    if (estimate.data?.autoConfirm && !started.current) {
      started.current = true;
      start.mutate();
    }
  }, [estimate.data, start]);

  return (
    <Card className="flex flex-col gap-3">
      {kind === "cv" ? (
        <FileDropzone
          value={file}
          onChange={(f) => {
            setFile(f);
            setUploaded(null);
            if (f) upload.mutate(f);
          }}
        />
      ) : (
        <>
          <FreeTextEditor value={text} onChange={setText} label={t("fileSource.textLabel")} />
          <div>
            <Button
              variant="outline"
              disabled={text.length < TEXT_MIN || upload.isPending}
              onClick={() => upload.mutate(text)}
            >
              {t("fileSource.estimate")}
            </Button>
          </div>
        </>
      )}
      {upload.isError ? <Alert tone="danger">{describeError(upload.error).title}</Alert> : null}
      {uploaded && seen && !readAgain ? (
        <AlreadyReadNotice file={uploaded} onReadAgain={() => setReadAgain(true)} />
      ) : null}
      {ready ? <EstimateCard estimate={estimate.data} loading={estimate.isFetching} /> : null}
      {estimate.data?.autoConfirm ? (
        <span className="text-sm text-muted-fg">{t("fileSource.autoStarting")}</span>
      ) : null}
      {ready && estimate.data && !estimate.data.autoConfirm ? (
        <div>
          <Button disabled={start.isPending} onClick={() => start.mutate()}>
            {t("fileSource.extract")}
          </Button>
        </div>
      ) : null}
      {start.isError ? <Alert tone="danger">{describeError(start.error).title}</Alert> : null}
    </Card>
  );
}
