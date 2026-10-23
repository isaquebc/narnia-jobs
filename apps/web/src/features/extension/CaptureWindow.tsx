import type { ExtensionCapture } from "@narnia-jobs/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Button, buttonClass } from "../../components/ui/button";
import { t } from "../../i18n";

/**
 * Janela da extensão (F12-2, F12/M2): aberta numa janela popup do Chrome sobre a página lida, sem o menu do narnia.
 * Modo vaga: o que o extrator da F06 tirou da página, o aviso de vaga já salva e "Salvar vaga". Links abrem fora da
 * janela (`target="_blank"` cai na janela normal do Chrome).
 */
export function CaptureWindow({
  captureId,
  error,
}: {
  captureId?: string | undefined;
  error?: string | undefined;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
        {t("capture.title")}
      </p>
      {captureId && !error ? (
        <CaptureView id={captureId} />
      ) : (
        <Alert tone="warn">
          {error === "envio" ? t("capture.sendFailed") : t("capture.readFailed")}
        </Alert>
      )}
    </div>
  );
}

function CaptureView({ id }: { id: string }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ["extension", "capture", id],
    queryFn: () => api.getExtensionCapture(id),
  });
  if (q.isPending) return <p className="text-sm text-muted-fg">{t("capture.loading")}</p>;
  if (q.isError) return <Alert tone="warn">{t("capture.notFound")}</Alert>;
  return <PostingCapture capture={q.data.capture} />;
}

const external = { target: "_blank", rel: "noreferrer" } as const;

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function PostingCapture({ capture }: { capture: ExtensionCapture }) {
  const api = useApi();
  const save = useMutation({ mutationFn: () => api.saveCapturePosting(capture.id) });
  const r = capture.reading;
  const savedId = save.data?.posting.id ?? capture.postingId;
  const meta = [r.siteName, t("capture.readFrom", { host: host(capture.url) })]
    .filter(Boolean)
    .join(" · ");
  if (!r.ok)
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="warn">{r.message}</Alert>
        <p className="text-xs text-muted-fg">{meta}</p>
        <a href="/vagas" {...external} className={buttonClass({ variant: "outline", size: "sm" })}>
          {t("capture.paste")}
        </a>
      </div>
    );
  const dup = capture.duplicate;
  return (
    <article className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold leading-tight">{r.title ?? t("capture.noTitle")}</h1>
        {r.company ? <span className="text-sm font-medium">{r.company}</span> : null}
        {r.location ? <span className="text-sm text-muted-fg">{r.location}</span> : null}
        <span className="text-xs text-muted-fg">{meta}</span>
      </header>
      {r.description ? (
        <p className="whitespace-pre-line break-words rounded-md border border-border bg-muted/40 p-3 text-sm">
          {r.description}
        </p>
      ) : null}
      {dup && !savedId ? (
        <Alert tone="info" className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {t("capture.duplicate", {
              name: [dup.title, dup.company].filter(Boolean).join(" · "),
            })}
          </span>
          <a
            href={`/vagas/${dup.id}`}
            {...external}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("capture.openDuplicate")}
          </a>
        </Alert>
      ) : null}
      {savedId ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-ok/40 bg-ok/10 p-3 text-sm"
        >
          <span>{save.data ? t("capture.saved") : t("capture.alreadySaved")}</span>
          <a
            href={`/vagas/${savedId}`}
            {...external}
            className={buttonClass({ variant: "outline", size: "sm" })}
          >
            {t("capture.open")}
          </a>
        </div>
      ) : (
        // a descrição pode ser longa: o botão fica sempre à vista no pé da janela
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-bg px-4 py-3">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t("capture.saving") : t("capture.save")}
          </Button>
          {save.isError ? (
            <Alert tone="danger">
              {t("capture.saveFail", { message: (save.error as Error).message })}
            </Alert>
          ) : null}
        </div>
      )}
    </article>
  );
}
