import {
  JOB_APPLICATION_COLUMNS,
  type JobApplicationClosedReason,
  JobApplicationClosedReasonSchema,
  type JobApplicationColumn,
  type JobApplicationSummary,
  type SavedPostingCard,
} from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Input, Select } from "../../components/ui/input";
import { Menu } from "../../components/ui/menu";
import { jobApplicationKeys, useJobApplications } from "../../hooks/useJobApplications";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { ApplyButton } from "./ApplyButton";

export const columnLabel = (c: JobApplicationColumn) => t(`jobApplications.column.${c}` as TKey);

export function applicationWho(a: {
  posting: Pick<JobApplicationSummary["posting"], "company" | "client">;
}): string {
  return (
    [a.posting.company, a.posting.client].filter(Boolean).join(" / ") ||
    t("jobApplications.noCompany")
  );
}

/** Mover de coluna; Encerrado pede o motivo (F07-6). Devolve a mutação e o diálogo do motivo. */
export function useMoveApplication() {
  const api = useApi();
  const qc = useQueryClient();
  const [closing, setClosing] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (v: {
      id: string;
      column: JobApplicationColumn;
      closedReason?: JobApplicationClosedReason;
    }) =>
      api.patchJobApplication(v.id, {
        column: v.column,
        ...(v.closedReason ? { closedReason: v.closedReason } : {}),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: jobApplicationKeys.all }),
  });
  const request = (id: string, column: JobApplicationColumn) =>
    column === "closed" ? setClosing(id) : move.mutate({ id, column });
  const dialog = closing ? (
    <CloseDialog
      onCancel={() => setClosing(null)}
      onConfirm={(closedReason) => {
        move.mutate({ id: closing, column: "closed", closedReason });
        setClosing(null);
      }}
    />
  ) : null;
  return { request, dialog, move };
}

function CloseDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (r: JobApplicationClosedReason) => void;
}) {
  const [reason, setReason] = useState<JobApplicationClosedReason | "">("");
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? null : onCancel())}
      title={t("jobApplications.close.title")}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason) onConfirm(reason);
        }}
      >
        <Field label={t("jobApplications.close.reason")} htmlFor="close-reason" required>
          <Select
            id="close-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as JobApplicationClosedReason)}
          >
            <option value="">{t("jobApplications.close.choose")}</option>
            {JobApplicationClosedReasonSchema.options.map((r) => (
              <option key={r} value={r}>
                {t(`jobApplications.closedReason.${r}` as TKey)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={!reason}>
            {t("jobApplications.close.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ApplicationCard({
  a,
  onMove,
}: {
  a: JobApplicationSummary;
  onMove: (id: string, c: JobApplicationColumn) => void;
}) {
  const tz = useTimezone();
  const stage = a.stages.find((s) => s.id === a.currentStageId);
  return (
    <li aria-label={`${applicationWho(a)} · ${a.posting.title ?? ""}`}>
      <Card className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <NavLink to={`/candidaturas/${a.id}`} className="font-medium hover:underline">
            {applicationWho(a)}
          </NavLink>
          {/* x/N: só em "Em processo" e só do pipeline desta candidatura (F07-8) */}
          {a.column === "in_process" && a.progress.total > 0 ? (
            <span className="shrink-0 rounded bg-muted px-1.5 text-xs font-medium tabular-nums">
              {`${a.progress.current}/${a.progress.total}`}
            </span>
          ) : null}
        </div>
        {a.posting.title ? <p className="text-sm">{a.posting.title}</p> : null}
        {a.column === "in_process" && stage ? (
          <p className="text-xs text-muted-fg">
            {t("jobApplications.stage", { name: stage.name })}
          </p>
        ) : null}
        {a.column === "closed" && a.closedReason ? (
          <p className="text-xs text-muted-fg">
            {t(`jobApplications.closedReason.${a.closedReason}` as TKey)}
          </p>
        ) : null}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-fg">
            {t("jobApplications.appliedOn", { date: formatDate(a.appliedOn, tz) })}
          </span>
          <Menu
            label={t("jobApplications.move")}
            variant="ghost"
            items={JOB_APPLICATION_COLUMNS.filter((c) => c !== a.column).map((c) => ({
              id: c,
              label: columnLabel(c),
              onSelect: () => onMove(a.id, c),
            }))}
          />
        </div>
      </Card>
    </li>
  );
}

/** Vaga salva sem candidatura: abre a vaga e aplica dali mesmo (o CV, se faltar, é gerado na vaga). */
function SavedCard({ p }: { p: SavedPostingCard }) {
  const tz = useTimezone();
  const navigate = useNavigate();
  return (
    <li aria-label={`${applicationWho({ posting: p })} · ${p.title ?? ""}`}>
      <Card className="flex flex-col gap-1 p-3">
        <NavLink to={`/vagas/${p.id}`} className="font-medium hover:underline">
          {applicationWho({ posting: p })}
        </NavLink>
        {p.title ? <p className="text-sm">{p.title}</p> : null}
        {p.archiveReason ? (
          <p className="text-xs text-muted-fg">
            {t("postings.archivedBadge", {
              reason: t(`postings.archiveReason.${p.archiveReason}` as TKey),
            })}
          </p>
        ) : null}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-fg">
            {t("jobApplications.savedOn", { date: formatDate(p.createdAt, tz) })}
          </span>
          {p.archivedAt ? null : (
            <ApplyButton
              postingId={p.id}
              onGenerateCv={() =>
                void navigate({ to: `/vagas/${p.id}` as string, search: { gerar: "cv" } as never })
              }
            />
          )}
        </div>
      </Card>
    </li>
  );
}

/**
 * Candidaturas (F07 §0): "Vagas salvas" (as sem candidatura) e o quadro de 5 colunas (a coluna é o que a pessoa move; o pipeline é de cada candidatura, F07-8),
 * busca por empresa, cliente, cargo, data e contato no servidor e as arquivadas (40 dias sem atividade) à parte.
 */
export function JobApplicationsPage() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const list = useJobApplications(q, archived);
  const { request, dialog } = useMoveApplication();
  if (list.isError) return <ErrorState error={list.error} />;
  const saved = list.data?.saved ?? [];
  const empty = list.data && list.applications.length === 0 && saved.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("jobApplications.title")}</h1>
        <p className="text-sm text-muted-fg">{t("jobApplications.hint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label={t("jobApplications.search")}
          placeholder={t("jobApplications.searchPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="max-w-md"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t("jobApplications.showArchived")}
        </label>
      </div>
      {archived ? (
        <p className="text-xs text-muted-fg">{t("jobApplications.archivedHint")}</p>
      ) : null}
      {empty ? (
        <p className="text-sm text-muted-fg">
          {q ? t("jobApplications.emptySearch") : t("jobApplications.empty")}
        </p>
      ) : null}
      <section
        aria-label={t("jobApplications.board")}
        className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {/* "Vagas salvas" (pedido do dono 2026-10-27): antes de Aplicado, as vagas sem candidatura */}
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-border p-2">
          <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
            {t("jobApplications.savedColumn")}
            <span aria-hidden className="text-xs font-normal text-muted-fg">
              {saved.length}
            </span>
          </h2>
          <ul aria-label={t("jobApplications.savedColumn")} className="flex flex-col gap-2">
            {saved.map((p) => (
              <SavedCard key={p.id} p={p} />
            ))}
          </ul>
        </div>
        {JOB_APPLICATION_COLUMNS.map((c) => {
          const items = list.applications.filter((a) => a.column === c);
          return (
            <div key={c} className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/40 p-2">
              <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                {columnLabel(c)}
                <span aria-hidden className="text-xs font-normal text-muted-fg">
                  {items.length}
                </span>
              </h2>
              <ul aria-label={columnLabel(c)} className="flex flex-col gap-2">
                {items.map((a) => (
                  <ApplicationCard key={a.id} a={a} onMove={request} />
                ))}
              </ul>
            </div>
          );
        })}
      </section>
      {dialog}
    </div>
  );
}
