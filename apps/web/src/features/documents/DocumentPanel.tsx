import type { CoverLetterFormat, CvContent, CvLinkKind, Paper } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CopyButton } from "../../components/ui/copy-button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { documentKeys, isDocumentActive } from "../../hooks/useDocuments";
import { type TKey, t } from "../../i18n";
import type { DocumentView } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { ContentEditor } from "./ContentEditor";

/**
 * Painel de um CV ou carta (F05 §4): etapa enquanto gera, prévia das páginas, "Baixar PDF", "Atualizar" com instruções,
 * data da versão, alerta "não passou na revisão" com os apontamentos, "desatualizado", nota ATS, links que faltam
 * (com atalho para cadastrar), fatos não verificados, score por experiência e skill, roteiro de entrevista e versões.
 */
const LINK_LABELS: Partial<Record<CvLinkKind, string>> = {
  linkedin: "LinkedIn",
  github: "GitHub",
  portfolio: "Portfólio",
};

export function DocumentPanel({ view, title }: { view: DocumentView; title?: ReactNode }) {
  const api = useApi();
  const qc = useQueryClient();
  const tz = useTimezone();
  const [updating, setUpdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [comparing, setComparing] = useState<number | null>(null);
  const { document: doc, current } = view;
  const kindLabel = t(`documents.kinds.${doc.kind}` as TKey);
  const active = isDocumentActive(current?.status);
  const remove = useMutation({
    mutationFn: () => api.deleteDocument(doc.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
  const errors = current?.review?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = current?.review?.issues.filter((i) => i.severity === "warning") ?? [];
  const staleWhy = view.stale
    ? (Object.entries(view.stale) as Array<[keyof NonNullable<DocumentView["stale"]>, boolean]>)
        .filter(([, v]) => v)
        .map(([k]) => t(`documents.staleWhy.${k}` as TKey))
    : [];
  const content = current?.content ?? null;
  const cv = content?.meta.kind === "cv" ? (content as CvContent) : null;
  const unverified = cv?.provenance.unverifiedFactIds.length ?? 0;
  return (
    <Card className="flex flex-col gap-3 p-4" aria-label={`${kindLabel} ${doc.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{title ?? kindLabel}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-fg">
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
            {current && !active ? (
              <span>{t("documents.generatedAt", { date: formatDate(current.updatedAt, tz) })}</span>
            ) : null}
            {current?.atsScore !== null && current?.atsScore !== undefined ? (
              <Badge tone={current.atsScore >= 90 ? "ok" : "warn"}>
                {t("documents.ats", { score: Math.round(current.atsScore) })}
              </Badge>
            ) : null}
            {staleWhy.length ? (
              <Badge tone="warn" title={staleWhy.join(", ")}>
                {t("documents.stale")}: {staleWhy.join(", ")}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {current?.pdfPath ? (
            <a
              href={api.documentPdfUrl(doc.id, current.version)}
              download
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              {t("documents.download")}
            </a>
          ) : null}
          {current?.content && !active ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t("documents.edit")}
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={active} onClick={() => setUpdating(true)}>
            {t("documents.update")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => window.confirm(t("documents.removeConfirm")) && remove.mutate()}
          >
            {t("documents.remove")}
          </Button>
        </div>
      </div>

      {current?.content && !active ? <LayoutControls view={view} /> : null}
      {current?.status === "error" ? (
        <Alert tone="danger" role="alert">
          <strong>{t("documents.errorTitle")}:</strong> {current.error}
        </Alert>
      ) : null}
      {current?.status === "ready_with_issues" ? (
        <Alert tone="warn" role="alert" aria-label={t("documents.status.ready_with_issues")}>
          <p>{t("documents.reviewFailed")}</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((i) => (
              <li key={`${i.area}-${i.message}`}>
                <strong>{t(`documents.areas.${i.area}` as TKey)}:</strong> {i.message}
                {i.where ? ` (${i.where})` : ""}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {view.missingLinks.length > 0 ? <MissingLinks kinds={view.missingLinks} /> : null}
      {unverified > 0 ? (
        <Alert tone="info">{t("documents.unverified", { count: unverified })}</Alert>
      ) : null}

      {current && !active && doc.format === "text" && current.textBody ? (
        <div className="flex flex-col gap-2">
          <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm">
            {current.textBody}
          </div>
          <div>
            <CopyButton text={current.textBody} />
          </div>
        </div>
      ) : null}
      {current?.pagesRendered ? (
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: current.pagesRendered }, (_, i) => i + 1).map((n) => (
            <img
              key={n}
              src={api.documentPageUrl(doc.id, current.version, n)}
              alt={t("documents.page", { n })}
              className="w-full max-w-[420px] rounded border border-border bg-white shadow-sm"
            />
          ))}
        </div>
      ) : null}

      {warnings.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-fg">{t("documents.warnings")}</summary>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((i) => (
              <li key={`${i.area}-${i.message}`}>
                <strong>{t(`documents.areas.${i.area}` as TKey)}:</strong> {i.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {cv ? <CvDetails cv={cv} /> : null}

      {view.versions.length > 1 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-fg">{t("documents.versions")}</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {view.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {t("documents.versionLine", { n: v.version, date: formatDate(v.createdAt, tz) })}{" "}
                  · {t(`documents.sourceLabels.${v.source}` as TKey)}
                </span>
                <Badge tone={v.passed ? "ok" : v.passed === false ? "warn" : "neutral"}>
                  {t(`documents.status.${v.status}` as TKey)}
                </Badge>
                {v.pagesRendered ? (
                  <a href={api.documentPdfUrl(doc.id, v.version)} download className="underline">
                    PDF
                  </a>
                ) : null}
                {v.version > 1 ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setComparing(v.version)}
                  >
                    {t("documents.compare")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <UpdateDialog view={view} open={updating} onOpenChange={setUpdating} />
      {editing ? <ContentEditor view={view} open onOpenChange={setEditing} /> : null}
      {comparing ? (
        <DiffDialog documentId={doc.id} to={comparing} onClose={() => setComparing(null)} />
      ) : null}
    </Card>
  );
}

function LayoutControls({ view }: { view: DocumentView }) {
  const api = useApi();
  const qc = useQueryClient();
  const ids = useId();
  const templates = useQuery({ queryKey: ["cv-templates"], queryFn: () => api.listCvTemplates() });
  const change = useMutation({
    mutationFn: (body: { templateId?: string; paper?: Paper; format?: CoverLetterFormat }) =>
      api.changeDocumentLayout(view.document.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
  const doc = view.document;
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      {doc.kind === "cv" || doc.format === "pdf" ? (
        <>
          <label className="flex flex-col gap-1" htmlFor={`${ids}-template`}>
            {t("documents.template")}
            <Select
              id={`${ids}-template`}
              className="h-8 w-40"
              value={doc.templateId}
              disabled={change.isPending}
              onChange={(e) => change.mutate({ templateId: e.target.value })}
            >
              {(templates.data?.templates ?? [{ id: doc.templateId, name: doc.templateId }]).map(
                (tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ),
              )}
            </Select>
          </label>
          <label className="flex flex-col gap-1" htmlFor={`${ids}-paper`}>
            {t("documents.paper")}
            <Select
              id={`${ids}-paper`}
              className="h-8 w-28"
              value={doc.paper}
              disabled={change.isPending}
              onChange={(e) => change.mutate({ paper: e.target.value as Paper })}
            >
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </Select>
          </label>
        </>
      ) : null}
      {doc.kind === "cover_letter" ? (
        <label className="flex flex-col gap-1" htmlFor={`${ids}-format`}>
          {t("documents.format")}
          <Select
            id={`${ids}-format`}
            className="h-8 w-48"
            value={doc.format}
            disabled={change.isPending}
            onChange={(e) => change.mutate({ format: e.target.value as CoverLetterFormat })}
          >
            <option value="pdf">{t("documents.formats.pdf")}</option>
            <option value="text">{t("documents.formats.text")}</option>
          </Select>
        </label>
      ) : null}
    </div>
  );
}

function DiffDialog({
  documentId,
  to,
  onClose,
}: {
  documentId: string;
  to: number;
  onClose: () => void;
}) {
  const api = useApi();
  const diff = useQuery({
    queryKey: ["documents", "diff", documentId, to],
    queryFn: () => api.documentDiff(documentId, to - 1, to),
  });
  const lines = (diff.data?.lines ?? []).map((l, i) => ({ ...l, at: i }));
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      wide
      title={t("documents.compareTitle", { from: to - 1, to })}
    >
      <ul className="flex flex-col gap-0.5 font-mono text-xs" aria-label={t("documents.compare")}>
        {lines.map((l) => (
          <li
            key={`${l.at}-${l.op}`}
            className={
              l.op === "+"
                ? "bg-ok/15"
                : l.op === "-"
                  ? "bg-danger/15 line-through"
                  : "text-muted-fg"
            }
          >
            {l.op === "=" ? "  " : `${l.op} `}
            {l.text}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function CvDetails({ cv }: { cv: CvContent }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-fg">{t("documents.details")}</summary>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        <section aria-label={t("documents.experiences")}>
          <h3 className="font-medium">{t("documents.experiences")}</h3>
          <ul>
            {cv.experiences.map((e) => (
              <li key={e.factId}>
                {e.company} · {e.title} — <strong>{e.matchScore}</strong>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label={t("documents.skills")}>
          <h3 className="font-medium">{t("documents.skills")}</h3>
          <ul>
            {cv.skills.flatMap((g) =>
              g.items.map((i) => (
                <li key={`${g.label}-${i.name}`}>
                  {i.name} — <strong>{i.matchScore}</strong>
                </li>
              )),
            )}
          </ul>
        </section>
        {cv.omitted.length ? (
          <section aria-label={t("documents.interview")}>
            <h3 className="font-medium">{t("documents.interview")}</h3>
            <p className="text-xs text-muted-fg">{t("documents.interviewHint")}</p>
            <ul>
              {cv.omitted.map((o) => (
                <li key={o.factId}>
                  {o.company} · {o.title}: {o.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {cv.adjacent.length ? (
          <section aria-label={t("documents.adjacent")}>
            <h3 className="font-medium">{t("documents.adjacent")}</h3>
            <ul>
              {cv.adjacent.map((a) => (
                <li key={a.asked}>
                  {t("documents.adjacentItem", { asked: a.asked, shown: a.shown })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </details>
  );
}

function MissingLinks({ kinds }: { kinds: CvLinkKind[] }) {
  const api = useApi();
  const qc = useQueryClient();
  const editable = kinds.filter((k) => LINK_LABELS[k]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (k: CvLinkKind) =>
      api.addUserLink({ label: LINK_LABELS[k] as string, url: values[k] ?? "" }),
    onSuccess: () => {
      setSaved(true);
      return qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
  return (
    <Alert tone="info">
      <p>
        {t("documents.missingLinks", {
          links: kinds.map((k) => t(`documents.linkKinds.${k}` as TKey)).join(", "),
        })}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {editable.map((k) => (
          <form
            key={k}
            className="flex flex-wrap items-center gap-2"
            aria-label={LINK_LABELS[k]}
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(k);
            }}
          >
            <span className="w-20 text-sm">{LINK_LABELS[k]}</span>
            <Input
              type="url"
              className="h-8 max-w-sm"
              aria-label={t("documents.addLink", { kind: LINK_LABELS[k] as string })}
              placeholder="https://"
              value={values[k] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
            />
            <Button type="submit" size="sm" variant="outline" disabled={!values[k]}>
              {t("documents.saveLink")}
            </Button>
          </form>
        ))}
        {saved ? <p className="text-xs">{t("documents.linkSaved")}</p> : null}
      </div>
    </Alert>
  );
}

function UpdateDialog({
  view,
  open,
  onOpenChange,
}: {
  view: DocumentView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [instructions, setInstructions] = useState("");
  const ids = useId();
  const kind = t(`documents.kinds.${view.document.kind}` as TKey);
  const run = useMutation({
    mutationFn: () =>
      // o documento já existe nesse idioma: a pessoa já decidiu na primeira geração
      api.regenerateDocument(view.document.id, {
        instructions: instructions || null,
        acceptLanguage: true,
      }),
    onSuccess: async () => {
      setInstructions("");
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("documents.updateTitle", { kind })}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-instructions`}>
          {t("documents.instructions")}
          <Textarea
            id={`${ids}-instructions`}
            className="min-h-24"
            placeholder={t("documents.instructionsHint")}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        {run.isError ? <Alert tone="danger">{(run.error as Error).message}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("documents.cancel")}
          </Button>
          <Button type="submit" disabled={run.isPending}>
            {t("documents.update")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
