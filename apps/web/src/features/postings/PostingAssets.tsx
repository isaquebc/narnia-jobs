import type { DocumentKind } from "@narnia-jobs/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useApi } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { CopyButton } from "../../components/ui/copy-button";
import { Dialog } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/input";
import { isDocumentActive, useDocuments } from "../../hooks/useDocuments";
import { type TKey, t } from "../../i18n";
import type { DocumentView } from "../../lib/api";

const KINDS: DocumentKind[] = ["cv", "cover_letter"];

/**
 * Página da vaga › assets (pedido do dono, 2026-10-19): CV e carta da vaga em miniatura (página 1), com baixar e
 * "Regerar com mensagem" (feedback humano: abre a conversa da vaga com a vaga e o documento no contexto). Sem o
 * documento, o atalho "Gerar" abre o diálogo de sempre. O painel completo (editar, versões) segue mais abaixo.
 */
export function PostingAssets({
  postingId,
  onGenerate,
}: {
  postingId: string;
  onGenerate: (kind: DocumentKind) => void;
}) {
  const { documents } = useDocuments({ postingId });
  return (
    <section aria-label={t("postings.assets.title")}>
      <Card className="flex flex-col gap-3">
        <CardTitle className="text-base">{t("postings.assets.title")}</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {KINDS.map((kind) => {
            // o mais recente desse tipo (a lista vem do mais novo para o mais velho)
            const view = documents.find((d) => d.document.kind === kind) ?? null;
            return (
              <AssetCard key={kind} kind={kind} view={view} onGenerate={() => onGenerate(kind)} />
            );
          })}
        </div>
      </Card>
    </section>
  );
}

function AssetCard({
  kind,
  view,
  onGenerate,
}: {
  kind: DocumentKind;
  view: DocumentView | null;
  onGenerate: () => void;
}) {
  const api = useApi();
  const [feedback, setFeedback] = useState(false);
  const label = t(`documents.kinds.${kind}` as TKey);
  const current = view?.current ?? null;
  const active = isDocumentActive(current?.status);
  const thumb =
    view && current?.pagesRendered
      ? api.documentPageUrl(view.document.id, current.version, 1)
      : null;
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex min-w-0 gap-3 rounded-md border border-border p-2"
    >
      <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
        {thumb ? (
          <img
            src={thumb}
            alt={t("postings.assets.page", { kind: label })}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <span className="px-1 text-center text-[10px] text-muted-fg">{label}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm font-medium">{label}</span>
          {current ? (
            <Badge
              tone={
                current.status === "ready"
                  ? "ok"
                  : current.status === "ready_with_issues"
                    ? "warn"
                    : current.status === "error"
                      ? "danger"
                      : "info"
              }
            >
              {t(`documents.status.${current.status}` as TKey)}
            </Badge>
          ) : null}
        </div>
        {!view ? (
          <>
            <p className="text-xs text-muted-fg">{t("postings.assets.none")}</p>
            <div>
              <Button type="button" size="sm" onClick={onGenerate}>
                {t(`postings.assets.generate.${kind}` as TKey)}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {current?.pdfPath ? (
              <a
                href={api.documentPdfUrl(view.document.id, current.version)}
                download
                className={buttonClass({ variant: "outline", size: "sm" })}
              >
                {t("documents.download")}
              </a>
            ) : null}
            {view.document.format === "text" && current?.textBody ? (
              <CopyButton text={current.textBody} />
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={active}
              onClick={() => setFeedback(true)}
            >
              {t("postings.assets.feedback")}
            </Button>
          </div>
        )}
      </div>
      {view && feedback ? (
        <FeedbackDialog documentId={view.document.id} onClose={() => setFeedback(false)} />
      ) : null}
    </fieldset>
  );
}

function FeedbackDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const id = useId();
  const [message, setMessage] = useState("");
  const send = useMutation({
    mutationFn: () => api.documentFeedback(documentId, message.trim()),
    onSuccess: ({ session }) => {
      onClose();
      void navigate({ to: `/chat/${session.id}` as string });
    },
  });
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())} title={t("postings.assets.feedback")}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) send.mutate();
        }}
      >
        <p className="text-sm text-muted-fg">{t("postings.assets.feedbackHelp")}</p>
        <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
          {t("postings.assets.feedbackLabel")}
          <Textarea
            id={id}
            className="min-h-24"
            placeholder={t("postings.assets.feedbackHint")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {send.isError ? (
          <Alert tone="danger">
            {describeError(send.error).hint ?? describeError(send.error).title}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("documents.cancel")}
          </Button>
          <Button type="submit" disabled={!message.trim() || send.isPending}>
            {t("postings.assets.feedbackSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
