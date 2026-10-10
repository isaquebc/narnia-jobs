import type { FileResponse } from "@narnia-jobs/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useApi } from "../../../app/context";
import { ErrorState } from "../../../components/ErrorState";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { TabPanel, Tabs } from "../../../components/ui/tabs";
import { t } from "../../../i18n";
import { AlreadyReadNotice } from "../../ingestion/FileSource";
import { EstimateBadge } from "../components/EstimateBadge";
import { ExtractionOptions, type ExtractionOptionsValue } from "../components/ExtractionOptions";
import { FileDropzone } from "../components/FileDropzone";
import { clearDraft, FreeTextEditor, loadDraft, TEXT_MIN } from "../components/FreeTextEditor";
import type { StepProps } from "../Wizard";

export function StepSource({ go }: StepProps) {
  const api = useApi();
  const [tab, setTab] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(() => loadDraft());
  const [options, setOptions] = useState<ExtractionOptionsValue>({ ocr: true, modelRead: true });
  const [error, setError] = useState<unknown>(null);

  const upload = useMutation({ mutationFn: (f: File) => api.uploadFile(f), onError: setError });
  const uploaded = upload.data ?? null;
  const pickFile = (f: File | null) => {
    setFile(f);
    setError(null);
    setReadAgain(false);
    autoStarted.current = false;
    if (f) upload.mutate(f);
    else upload.reset();
  };

  // F03-13 e "já lido" no onboarding (correções da auditoria F03, item 9)
  const [readAgain, setReadAgain] = useState(false);
  const [textSeen, setTextSeen] = useState<FileResponse | null>(null);
  const autoStarted = useRef(false);
  const seen = (uploaded?.previousRuns ?? []).length > 0;
  const ready = Boolean(uploaded?.id) && (!seen || readAgain);
  const auto = useQuery({
    queryKey: ["ingestion", "estimate", "onboarding", uploaded?.id],
    queryFn: () => api.estimateIngestion({ source: "cv", fileId: uploaded?.id as string }),
    enabled: tab === "file" && ready,
  });

  const isPdf = Boolean(file && /\.pdf$/i.test(file.name));
  const estimate = useQuery({
    queryKey: ["estimate", uploaded?.id, options],
    queryFn: () => api.getEstimate(uploaded?.id as string, options),
    enabled: Boolean(uploaded?.id),
  });

  const start = useMutation({
    mutationFn: async () => {
      let fileId = uploaded?.id;
      if (tab === "text") {
        const created = textSeen ?? (await api.createText(text));
        if (!textSeen && (created.previousRuns ?? []).length > 0) {
          setTextSeen(created); // já lido: mostra o aviso e espera "Ler de novo"
          return;
        }
        fileId = created.id;
        clearDraft();
      }
      if (!fileId) throw new Error("missing_file");
      const run = await api.createIngestion({ fileId, options });
      await go({ step: 3, runId: run.id, fileId });
    },
    onError: setError,
  });

  useEffect(() => {
    if (tab === "file" && auto.data?.autoConfirm && !autoStarted.current) {
      autoStarted.current = true;
      start.mutate();
    }
  }, [tab, auto.data, start]);

  const canExtract =
    tab === "file" ? ready && !upload.isPending : text.length >= TEXT_MIN && !textSeen;

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">{t("source.title")}</h2>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "file" | "text")}
        items={[
          { value: "file", label: t("source.tabFile") },
          { value: "text", label: t("source.tabText") },
        ]}
      >
        <TabPanel value="file" className="flex flex-col gap-4">
          <FileDropzone value={file} onChange={pickFile} />
          {uploaded?.pages && uploaded.pages > 20 ? (
            <Alert tone="warn">{t("source.manyPages")}</Alert>
          ) : null}
          {upload.isPending ? (
            <p className="text-sm text-muted-fg">{t("source.uploading")}</p>
          ) : null}
          <ExtractionOptions isPdf={isPdf} value={options} onChange={setOptions} />
          {uploaded && seen && !readAgain ? (
            <AlreadyReadNotice file={uploaded} onReadAgain={() => setReadAgain(true)} />
          ) : null}
          {uploaded && ready ? (
            <EstimateBadge loading={estimate.isLoading} estimate={estimate.data ?? null} />
          ) : null}
          {auto.data?.autoConfirm ? (
            <span className="text-sm text-muted-fg">{t("fileSource.autoStarting")}</span>
          ) : null}
        </TabPanel>
        <TabPanel value="text">
          <FreeTextEditor
            value={text}
            onChange={(v) => {
              setText(v);
              setTextSeen(null);
            }}
          />
          {textSeen ? (
            <AlreadyReadNotice
              file={textSeen}
              onReadAgain={() => {
                const again = textSeen;
                setTextSeen(null);
                void (async () => {
                  clearDraft();
                  const run = await api.createIngestion({ fileId: again.id, options });
                  await go({ step: 3, runId: run.id, fileId: again.id });
                })().catch(setError);
              }}
            />
          ) : null}
        </TabPanel>
      </Tabs>
      {error ? <ErrorState error={error} /> : null}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => void go({ step: 4 })}>
          {t("source.skip")}
        </Button>
        <Button disabled={!canExtract || start.isPending} onClick={() => start.mutate()}>
          {t("source.extract")}
        </Button>
      </div>
    </Card>
  );
}
