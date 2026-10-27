import {
  type Posting,
  type PostingArchiveReason,
  PostingArchiveReasonSchema,
} from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Select, Textarea } from "../../components/ui/input";
import { jobApplicationKeys } from "../../hooks/useJobApplications";
import { postingKeys } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";

const reasonLabel = (r: PostingArchiveReason) => t(`postings.archiveReason.${r}` as TKey);

function useInvalidate() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: postingKeys.all });
    await qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
  };
}

/**
 * Arquivar a vaga salva que não deu um bom fit (F07, pedido do dono 2026-10-27): o motivo é obrigatório e a nota
 * opcional; ficam guardados para o recrutador calibrar o fit das próximas vagas.
 */
export function ArchivePostingButton({ postingId }: { postingId: string }) {
  const api = useApi();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PostingArchiveReason | "">("");
  const [note, setNote] = useState("");
  const archive = useMutation({
    mutationFn: () =>
      api.archivePosting(postingId, {
        reason: reason as PostingArchiveReason,
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      await invalidate();
      setOpen(false);
    },
  });
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("postings.archive.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t("postings.archive.title")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) archive.mutate();
          }}
        >
          <p className="text-sm text-muted-fg">{t("postings.archive.hint")}</p>
          <Field label={t("postings.archive.reason")} htmlFor="archive-reason" required>
            <Select
              id="archive-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as PostingArchiveReason)}
            >
              <option value="">{t("postings.archive.choose")}</option>
              {PostingArchiveReasonSchema.options.map((r) => (
                <option key={r} value={r}>
                  {reasonLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("postings.archive.note")} htmlFor="archive-note">
            <Textarea
              id="archive-note"
              rows={3}
              value={note}
              placeholder={t("postings.archive.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {archive.error ? <Alert tone="danger">{archive.error.message}</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={!reason || archive.isPending}>
              {t("postings.archive.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Vaga arquivada: o motivo e a nota no topo da página e o "Desarquivar". */
export function ArchivedPostingBanner({ posting }: { posting: Posting }) {
  const api = useApi();
  const tz = useTimezone();
  const invalidate = useInvalidate();
  const unarchive = useMutation({
    mutationFn: () => api.unarchivePosting(posting.id),
    onSuccess: invalidate,
  });
  if (!posting.archivedAt) return null;
  return (
    <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <span>
          {t("postings.archive.archivedAt", {
            date: formatDate(posting.archivedAt, tz),
            reason: posting.archiveReason ? reasonLabel(posting.archiveReason) : "—",
          })}
        </span>
        {posting.archiveNote ? <span className="text-sm">{posting.archiveNote}</span> : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={unarchive.isPending}
        onClick={() => unarchive.mutate()}
      >
        {t("postings.archive.unarchive")}
      </Button>
    </Alert>
  );
}
