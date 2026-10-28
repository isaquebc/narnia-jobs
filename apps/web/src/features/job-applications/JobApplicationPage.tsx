import { JOB_APPLICATION_COLUMNS, type LockedDocument } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useApi, useTimezone } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Menu } from "../../components/ui/menu";
import { jobApplicationKeys, useJobApplication } from "../../hooks/useJobApplications";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { AgendaCard } from "./AgendaCard";
import { ChatAboutCard } from "./ChatAboutCard";
import { ContactChainCard } from "./ContactChainCard";
import { EntriesCard } from "./EntriesCard";
import { applicationWho, columnLabel, useMoveApplication } from "./JobApplicationsPage";
import { StagesEditor } from "./StagesEditor";

function LockedDoc({
  label,
  doc,
  letter = false,
}: {
  label: string;
  doc: LockedDocument;
  letter?: boolean;
}) {
  const api = useApi();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        {label} ·{" "}
        {t(
          letter
            ? "jobApplications.apply.letterOption"
            : doc.scope === "posting"
              ? "jobApplications.apply.cvPosting"
              : "jobApplications.apply.cvProfile",
          { version: doc.version },
        )}
      </span>
      <a
        href={api.documentPdfUrl(doc.documentId, doc.version)}
        download
        className={buttonClass({ variant: "outline", size: "sm" })}
      >
        {t("jobApplications.detail.versionDownload", { version: doc.version })}
      </a>
    </div>
  );
}

/**
 * Uma candidatura (F07 §0): a vaga, o currículo e a carta enviados (versões travadas), a data, a coluna (mover;
 * Encerrado pede o motivo), as etapas do processo dela (editáveis, F07/M2), as notas e os anexos datados (M3) e arquivar,
 * desarquivar ou apagar.
 */
export function JobApplicationPage({ id }: { id: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const navigate = useNavigate();
  const q = useJobApplication(id);
  const { request, dialog } = useMoveApplication();
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.patchJobApplication(id, { archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobApplicationKeys.all }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteJobApplication(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
      void navigate({ to: "/candidaturas" });
    },
  });
  if (q.isError) return <ErrorState error={q.error} />;
  const a = q.data?.application;
  if (!a) return <p className="text-sm text-muted-fg">…</p>;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <NavLink to="/candidaturas" className="text-xs text-muted-fg underline">
            {t("jobApplications.detail.back")}
          </NavLink>
          <h1 className="text-xl font-semibold">{applicationWho(a)}</h1>
          <p className="text-sm text-muted-fg">
            {[
              a.posting.title,
              t("jobApplications.appliedOn", { date: formatDate(a.appliedOn, tz) }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={a.column === "closed" ? "neutral" : "ok"}>{columnLabel(a.column)}</Badge>
          {a.archivedAt ? (
            <Badge tone="warn">
              {t("jobApplications.detail.archivedAt", { date: formatDate(a.archivedAt, tz) })}
            </Badge>
          ) : null}
          <NavLink
            to={`/vagas/${a.postingId}`}
            className={buttonClass({ variant: "outline", size: "sm" })}
          >
            {t("jobApplications.detail.posting")}
          </NavLink>
          <Menu
            label={t("jobApplications.move")}
            items={JOB_APPLICATION_COLUMNS.filter((c) => c !== a.column).map((c) => ({
              id: c,
              label: columnLabel(c),
              onSelect: () => request(a.id, c),
            }))}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={archive.isPending}
            onClick={() => archive.mutate(!a.archivedAt)}
          >
            {a.archivedAt
              ? t("jobApplications.detail.unarchive")
              : t("jobApplications.detail.archive")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              window.confirm(t("jobApplications.detail.removeConfirm")) && remove.mutate()
            }
          >
            {t("jobApplications.detail.remove")}
          </Button>
        </div>
      </div>
      {a.column === "closed" && a.closedReason ? (
        <p className="text-sm">{t(`jobApplications.closedReason.${a.closedReason}` as TKey)}</p>
      ) : null}
      <Card className="flex flex-col gap-2">
        <LockedDoc label={t("jobApplications.detail.cv")} doc={a.cv} />
        {a.coverLetter ? (
          <LockedDoc label={t("jobApplications.detail.letter")} doc={a.coverLetter} letter />
        ) : (
          <p className="text-sm text-muted-fg">{t("jobApplications.detail.noLetter")}</p>
        )}
      </Card>
      <ChatAboutCard appId={a.id} />
      <StagesEditor application={a} />
      <AgendaCard application={a} />
      <ContactChainCard postingId={a.postingId} />
      <EntriesCard appId={a.id} />
      {dialog}
    </div>
  );
}
