import type { PreAnalysis } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useApi } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { postingKeys, usePosting } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { AnalysisCard, PreAnalysisCard } from "./PostingAnalysis";
import { PostingForm } from "./PostingForm";
import { ContactsCard, DuplicateDialog, NotesCard } from "./PostingSections";
import { postingWho, statusTone } from "./PostingsPage";

/**
 * Página da vaga (F06 §1.3, M6): duplicata pendente (F06-9), análise do recrutador com validade (F06-10), pré-análise
 * sem tokens, todos os campos editáveis com a origem de cada um, contatos e notas. "Criar CV" e o alerta de
 * candidatura repetida ficam "em breve" (F05, F06-11).
 */
export function PostingPage({
  postingId,
  noteId,
}: {
  postingId: string;
  noteId?: string | undefined;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { detail, analyses } = usePosting(postingId);
  const reextract = useMutation({
    mutationFn: () => api.reextractPosting(postingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: postingKeys.all }),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePosting(postingId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: postingKeys.all });
      void navigate({ to: "/vagas" });
    },
  });
  if (detail.isError) return <ErrorState error={detail.error} />;
  if (!detail.data) return <p className="text-sm text-muted-fg">…</p>;
  const { posting, contacts, notes } = detail.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <NavLink to="/vagas" className="text-xs text-muted-fg underline">
            {t("postings.title")}
          </NavLink>
          <h1 className="text-xl font-semibold">
            {postingWho(posting)}
            {posting.role ? ` - ${t(`postings.role.${posting.role}` as TKey)}` : ""}
          </h1>
          <p className="text-sm text-muted-fg">{posting.title ?? ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone[posting.status]}>
            {t(`postings.status.${posting.status}` as TKey)}
          </Badge>
          {posting.jdText ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={posting.status === "extracting" || reextract.isPending}
              onClick={() => reextract.mutate()}
            >
              {t("postings.reextract")}
            </Button>
          ) : null}
          <Tooltip content={t("nav.soon", { task: "F05" })}>
            <span>
              <Button type="button" size="sm" disabled>
                {t("postings.analysis.createCv")}
              </Button>
            </span>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => window.confirm(t("postings.removeConfirm")) && remove.mutate()}
          >
            {t("postings.remove")}
          </Button>
        </div>
      </div>
      <DuplicateDialog
        posting={posting}
        onDecided={(r) => {
          if (r.removedId === postingId && r.keptId)
            void navigate({ to: `/vagas/${r.keptId}` as string });
          else if (r.removedId === postingId) void navigate({ to: "/vagas" });
        }}
      />
      <Alert tone="info" className="flex items-center justify-between gap-2">
        <span>{t("postings.analysis.applicationAlert")}</span>
        <Badge>{t("nav.soon", { task: "F07" })}</Badge>
      </Alert>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AnalysisCard postingId={postingId} analyses={analyses.data?.analyses ?? []} />
        <PreAnalysisCard pre={posting.preAnalysis as PreAnalysis | null} />
      </div>
      <PostingForm posting={posting} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ContactsCard postingId={postingId} contacts={contacts} />
        <NotesCard postingId={postingId} notes={notes} focusNoteId={noteId} />
      </div>
    </div>
  );
}
