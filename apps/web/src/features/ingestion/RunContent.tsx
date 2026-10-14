import { useState } from "react";
import { useTimezone } from "../../app/context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { useFileText } from "../../hooks/useRepos";
import { type TKey, t } from "../../i18n";
import type { IngestionDetail } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { proposalSummary } from "../onboarding/components/ProposalList";
import { originText, referenceText } from "./proposalReference";

const ACTIVE = new Set(["estimating", "queued", "running", "awaiting_confirmation"]);

/**
 * O que está sendo ou foi ingerido (pedido do dono, 2026-10-14): em qualquer estado da execução, a origem, o texto
 * enviado (texto livre) ou o arquivo com o registro de contexto e o texto lido sob demanda. Antes, ao terminar, a
 * página não dizia o que tinha entrado.
 */
export function RunContent({ run }: { run: IngestionDetail }) {
  const tz = useTimezone();
  const isText = run.source === "text";
  const [open, setOpen] = useState(false);
  const fileId = run.fileId ?? "";
  // texto livre aparece direto; o texto lido de um arquivo só sob demanda (pode ser longo)
  const text = useFileText(fileId, Boolean(run.fileId) && (isText || open));
  const label = ACTIVE.has(run.status) ? t("runPage.content.active") : t("runPage.content.done");
  const digest = run.digest;
  return (
    <Card className="flex flex-col gap-3">
      <section aria-label={label} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{label}</h2>
        <p className="text-xs text-muted-fg">
          <span className="font-medium text-fg">{t("review3.origin.label")}:</span>{" "}
          {originText(run.source, run.origin)}
          {run.createdAt ? ` · ${formatDate(run.createdAt, tz)}` : ""}
        </p>
        {digest ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm">{digest.summary}</p>
            {digest.keyPoints.length > 0 ? (
              <ul className="list-disc pl-5 text-sm">
                {digest.keyPoints.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {run.fileId && !isText ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? t("runPage.content.hideText") : t("runPage.content.showText")}
            </Button>
          </div>
        ) : null}
        {run.fileId && (isText || open) ? (
          text.isLoading ? (
            <p className="text-sm text-muted-fg">{t("app.loading")}</p>
          ) : (
            <pre
              data-testid="ingested-text"
              className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs"
            >
              {text.data?.text ?? t("runPage.content.noText")}
            </pre>
          )
        ) : null}
      </section>
    </Card>
  );
}

const DECISION_TONE = {
  accepted: "ok",
  edited: "ok",
  rejected: "danger",
  pending: "neutral",
} as const;

/** Depois de salva: cada item com a decisão e onde entrou no perfil. */
export function RunResult({ run }: { run: IngestionDetail }) {
  if (run.proposals.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <section aria-label={t("runPage.result.title")} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("runPage.result.title")}</h2>
        <ul className="flex flex-col gap-2">
          {run.proposals.map((p) => {
            const summary = proposalSummary(p.proposal);
            return (
              <li
                key={p.id}
                aria-label={summary}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-2"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm">{summary}</span>
                  <p className="text-xs" data-testid="entry-reference">
                    <span className="font-medium">{t("review3.refLabel")}:</span>{" "}
                    {referenceText(p.proposal, p.reference, p.match ?? "new")}
                  </p>
                </div>
                <Badge tone={DECISION_TONE[p.decision]}>
                  {t(`runPage.result.${p.decision}` as TKey)}
                </Badge>
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
