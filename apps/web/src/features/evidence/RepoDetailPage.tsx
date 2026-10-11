import type { GithubMetrics, RepoAnalysis } from "@narnia-jobs/shared";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTimezone } from "../../app/context";
import { describeError, ErrorState } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/input";
import { useRepo } from "../../hooks/useRepos";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";

const METRICS: Array<keyof GithubMetrics> = [
  "commits",
  "prsOpened",
  "prsMerged",
  "prsClosed",
  "reviewsApproved",
  "issuesOpened",
  "issuesClosed",
];
type Kind = "incremental" | "deepen" | "cover";
const KINDS: Kind[] = ["incremental", "deepen", "cover"];

function plural(n: number, one: TKey, many: TKey) {
  return `${n} ${t(n === 1 ? one : many)}`;
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="list-disc pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function ReanalyzeDialog({
  open,
  onOpenChange,
  fullName,
  latest,
  pending,
  error,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fullName: string;
  latest: RepoAnalysis | undefined;
  pending: boolean;
  error: unknown;
  onCreate: (k: Kind) => void;
}) {
  const [kind, setKind] = useState<Kind>("incremental");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("reanalyze.title", { name: fullName })}
    >
      <div className="flex flex-col gap-3">
        {latest ? (
          <span className="text-sm text-muted-fg">
            {t("reanalyze.coverage", {
              files: plural(latest.coverage.files.length, "reanalyze.file", "reanalyze.files"),
              topics: plural(latest.coverage.topics.length, "reanalyze.topic", "reanalyze.topics"),
            })}
          </span>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t("reanalyze.legend")}</legend>
          {KINDS.map((k) => (
            <div key={k} className="flex flex-col">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reanalyze-kind"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {t(`reanalyze.kinds.${k}` as TKey)}
              </label>
              <span className="pl-6 text-xs text-muted-fg">
                {t(`reanalyze.hints.${k}` as TKey)}
              </span>
            </div>
          ))}
        </fieldset>
        <span className="text-sm">{t("reanalyze.newRunNotice")}</span>
        <span className="text-xs text-muted-fg">{t("reanalyze.confirmHint")}</span>
        {error ? <Alert tone="danger">{describeError(error).title}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("app.cancel")}
          </Button>
          <Button disabled={pending} onClick={() => onCreate(kind)}>
            {t("reanalyze.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Detalhe do repositório (F03 §4): relatório da última análise, métricas, histórico, digest editável e reanálise. */
export function RepoDetailPage({ repoId }: { repoId: string }) {
  const tz = useTimezone();
  const navigate = useNavigate();
  const { data, isError, error, refetch, saveDigest, reanalyze } = useRepo(repoId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState(false);
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const { repo, digest, metrics } = data;
  const analyses = [...data.analyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = analyses.find((a) => a.status === "done");
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{repo.fullName}</h1>
        <div className="flex items-center gap-2">
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            {t("repoDetail.openGithub")}
          </a>
          <Button size="sm" onClick={() => setDialog(true)}>
            {t("repoDetail.reanalyze")}
          </Button>
        </div>
      </div>

      {latest?.report ? (
        <Card>
          <section aria-label={t("repoDetail.report")} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t("repoDetail.report")}</h2>
            <p className="text-sm">{latest.report.summary}</p>
            <ReportList title={t("repoDetail.stack")} items={latest.report.stack} />
            <ReportList title={t("repoDetail.highlights")} items={latest.report.highlights} />
            <ReportList title={t("repoDetail.risks")} items={latest.report.risks} />
            <ReportList title={t("repoDetail.suggested")} items={latest.report.suggestedProjects} />
          </section>
        </Card>
      ) : null}

      {metrics ? (
        <Card>
          <section aria-label={t("repoDetail.metrics")} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t("repoDetail.metrics")}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {METRICS.map((m) => (
                <div key={m} className="flex justify-between gap-2">
                  <dt>{t(`repoDetail.metric.${m}` as TKey)}</dt>
                  <dd className="font-medium">{metrics[m] ?? 0}</dd>
                </div>
              ))}
            </dl>
          </section>
        </Card>
      ) : null}

      <Card>
        <section aria-label={t("repoDetail.digest")} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t("repoDetail.digest")}</h2>
          {digest && !editing ? (
            <>
              <p className="text-sm">{digest.summary}</p>
              <ReportList title={t("repoDetail.keyPoints")} items={digest.keyPoints} />
              {digest.editedByUser ? (
                <span className="text-xs text-muted-fg">{t("repoDetail.edited")}</span>
              ) : null}
            </>
          ) : null}
          {!digest ? <p className="text-sm text-muted-fg">{t("repoDetail.noDigest")}</p> : null}
          {digest && editing ? (
            <Textarea
              aria-label={t("repoDetail.summary")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-32"
            />
          ) : null}
          {digest ? (
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button
                    size="sm"
                    disabled={!draft.trim() || saveDigest.isPending}
                    onClick={() => {
                      const { repoId: _id, editedByUser: _e, ...rest } = digest;
                      saveDigest.mutate(
                        { ...rest, summary: draft.trim() },
                        { onSuccess: () => setEditing(false) },
                      );
                    }}
                  >
                    {t("repoDetail.saveDigest")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                    {t("app.cancel")}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft(digest.summary);
                    setEditing(true);
                  }}
                >
                  {t("repoDetail.editDigest")}
                </Button>
              )}
            </div>
          ) : null}
        </section>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("repoDetail.history")}</h2>
        {analyses.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("repoDetail.noAnalyses")}</p>
        ) : (
          <ul aria-label={t("repoDetail.history")} className="flex flex-col gap-1 text-sm">
            {analyses.map((a) => (
              <li key={a.id}>
                {t("repoDetail.analysisLine", {
                  kind: t(`repoDetail.kind.${a.kind}` as TKey),
                  depth: t(`github.depth.${a.depth}` as TKey),
                  sha: (a.headSha ?? "").slice(0, 7) || "—",
                  date: formatDate(a.createdAt, tz),
                })}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ReanalyzeDialog
        open={dialog}
        onOpenChange={setDialog}
        fullName={repo.fullName}
        latest={latest}
        pending={reanalyze.isPending}
        error={reanalyze.error}
        onCreate={(k) =>
          reanalyze.mutate(k, {
            onSuccess: (run) => navigate({ to: "/ingestao/$runId", params: { runId: run.id } }),
          })
        }
      />
    </div>
  );
}
