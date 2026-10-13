import type { EvidenceFile } from "@narnia-jobs/shared";
import { useState } from "react";
import { useTimezone } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useEvidenceFiles, useFileText } from "../../hooks/useRepos";
import { t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { EvidenceTabs } from "./EvidenceTabs";

/**
 * Evidências › Arquivos e textos (layout L3, cartão de arquivo): o registro de contexto de cada CV ou texto ingerido,
 * os fatos que saíram dele e o texto lido sob demanda.
 */
export function FilesPage() {
  const files = useEvidenceFiles();
  const list = files.data?.files ?? [];
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("evidence.files.title")}</h1>
      <EvidenceTabs />
      {files.isLoading ? <p className="text-sm text-muted-fg">{t("app.loading")}</p> : null}
      {!files.isLoading && list.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-fg">{t("evidence.files.empty")}</p>
          <div>
            <NavLink
              to="/ingestao"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-fg hover:opacity-90"
            >
              {t("evidence.files.goIngest")}
            </NavLink>
          </div>
        </div>
      ) : null}
      {list.length > 0 ? (
        <ul aria-label={t("evidence.files.list")} className="flex flex-col gap-3">
          {list.map((f) => (
            <FileCard key={f.id} file={f} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FileCard({ file: f }: { file: EvidenceFile }) {
  const tz = useTimezone();
  const [open, setOpen] = useState(false);
  const text = useFileText(f.id, open);
  const name = f.originalName ?? t("evidence.files.freeText");
  const kind =
    f.kind === "cv"
      ? [t("evidence.files.cv"), f.pages ? t("evidence.files.pages", { count: f.pages }) : null]
          .filter(Boolean)
          .join(" · ")
      : t("evidence.files.freeText");
  const last = f.runs[0];
  return (
    <li aria-label={name} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-fg">{formatDate(f.uploadedAt, tz)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">{kind}</Badge>
          {last ? (
            <NavLink
              to={`/ingestao/${last.runId}`}
              className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
            >
              {t("evidence.files.lastRun")}
            </NavLink>
          ) : null}
        </div>
      </div>
      {f.digest ? (
        <>
          <p className="text-sm">{f.digest.summary}</p>
          {f.digest.keyPoints.length > 0 ? (
            <ul className="list-disc pl-5 text-sm">
              {f.digest.keyPoints.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-fg">{t("evidence.files.noDigest")}</p>
      )}
      {f.facts.total > 0 ? (
        <p className="text-xs text-muted-fg">{t("evidence.files.facts", f.facts)}</p>
      ) : null}
      <div>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? t("evidence.files.hideText") : t("evidence.files.showText")}
        </Button>
      </div>
      {open ? (
        text.isLoading ? (
          <p className="text-sm text-muted-fg">{t("app.loading")}</p>
        ) : (
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {text.data?.text ?? t("evidence.files.noText")}
          </pre>
        )
      ) : null}
    </li>
  );
}
