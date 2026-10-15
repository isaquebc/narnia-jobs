import type { PreAnalysis, PreAnalysisKeyword } from "@narnia-jobs/shared";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Tooltip } from "../../components/ui/tooltip";
import { useProfiles } from "../../hooks/useProfiles";
import { type TKey, t } from "../../i18n";
import type { PostingAnalysisView } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { type SessionLimit, SessionLimitDialog, sessionLimitOf } from "../chat/SessionLimitDialog";
import { SourceBadge } from "./PostingForm";

function KeywordChip({ k }: { k: PreAnalysisKeyword }) {
  const has = k.evidence.length > 0;
  return (
    <li className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
      <span aria-hidden className={has ? "text-ok" : "text-muted-fg"}>
        {has ? "●" : "○"}
      </span>
      <Tooltip
        content={has ? k.evidence.map((e) => e.label).join(" · ") : t("postings.pre.noEvidence")}
      >
        <span>{k.term}</span>
      </Tooltip>
      <span className="sr-only">
        {has
          ? t("postings.pre.evidence", { count: k.evidence.length })
          : t("postings.pre.noEvidence")}
      </span>
      <SourceBadge source={k.source} />
    </li>
  );
}

/** Pré-análise sem tokens (M3): keywords com evidência local e origem, cobertura e riscos do perfil ativo. */
export function PreAnalysisCard({ pre }: { pre: PreAnalysis | null }) {
  const { active } = useProfiles();
  if (!pre) return null;
  const group = (section: PreAnalysisKeyword["section"]) =>
    pre.keywords.filter((k) => k.section === section);
  const risks = active ? (pre.risksByProfile[active.id] ?? []) : [];
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="text-base">{t("postings.pre.title")}</CardTitle>
      <p className="text-sm">
        {pre.coverage === null
          ? t("postings.pre.noCoverage")
          : t("postings.pre.coverage", { pct: Math.round(pre.coverage * 100) })}
      </p>
      {(["required", "nice", "other"] as const).map((section) =>
        group(section).length > 0 ? (
          <div key={section}>
            <p className="mb-1 text-xs font-medium uppercase text-muted-fg">
              {t(`postings.pre.${section}` as TKey)}
            </p>
            <ul aria-label={t(`postings.pre.${section}` as TKey)} className="flex flex-wrap gap-1">
              {group(section).map((k) => (
                <KeywordChip key={k.term} k={k} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {active ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase text-muted-fg">
            {t("postings.pre.risks", { profile: active.name })}
          </p>
          {risks.length === 0 ? (
            <p className="text-sm text-muted-fg">{t("postings.pre.noRisks")}</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {risks.map((r) => (
                <li key={r.description}>{r.description}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {pre.ngrams.length > 0 ? (
        <p className="text-xs text-muted-fg">
          {t("postings.pre.ngrams")}: {pre.ngrams.join(", ")}
        </p>
      ) : null}
    </Card>
  );
}

function List<T>({
  title,
  items,
  render,
}: {
  title: string;
  items: T[];
  render: (x: T) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{title}</p>
      <ul aria-label={title} className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {items.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: itens da análise não têm id e não são reordenados
          <li key={i}>{render(x)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Abre a conversa da análise (ou da reanálise) e vai até ela; teto cheio pergunta qual encerrar (F06-15). */
function useStartAnalysis(postingId: string) {
  const api = useApi();
  const navigate = useNavigate();
  const [limit, setLimit] = useState<SessionLimit | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const r = await api.analyzePosting(postingId);
      void navigate({ to: `/chat/${r.session.id}` as string });
    } catch (e) {
      const l = sessionLimitOf(e);
      if (l) setLimit(l);
      else throw e;
    } finally {
      setBusy(false);
    }
  };
  const closeAndStart = async (id: string) => {
    await api.hibernateChat(id);
    setLimit(null);
    await start();
  };
  return { start, busy, limit, setLimit, closeAndStart };
}

/** Análise do recrutador (M5): validade, fit por perfil, recomendado e o resto do `JobAnalysis`. */
export function AnalysisCard({
  postingId,
  analyses,
}: {
  postingId: string;
  analyses: PostingAnalysisView[];
}) {
  const tz = useTimezone();
  const { profiles } = useProfiles();
  const { start, busy, limit, setLimit, closeAndStart } = useStartAnalysis(postingId);
  const latest = analyses[0];
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
  const ev = (refs: Array<{ kind: string; id: string }>) =>
    refs.map((r) => latest?.labels[`${r.kind}:${r.id}`] ?? r.kind).join(" · ");
  const dialog = (
    <SessionLimitDialog
      limit={limit}
      onCancel={() => setLimit(null)}
      onChoose={(id) => void closeAndStart(id)}
    />
  );
  if (!latest)
    return (
      <Card className="flex flex-col gap-2">
        <CardTitle className="text-base">{t("postings.analysis.title")}</CardTitle>
        <p className="text-sm text-muted-fg">{t("postings.analysis.none")}</p>
        <div>
          <Button type="button" onClick={() => void start()} disabled={busy}>
            {t("postings.analysis.start")}
          </Button>
        </div>
        {dialog}
      </Card>
    );
  const a = latest.analysis;
  const stale = latest.stale.facts || latest.stale.posting;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("postings.analysis.title")}</CardTitle>
        <span className="text-xs text-muted-fg">
          {t("postings.analysis.at", { date: formatDate(latest.createdAt, tz) })}
          {latest.chatSessionId ? (
            <>
              {" · "}
              <NavLink to={`/chat/${latest.chatSessionId}`} className="underline">
                {t("postings.analysis.openChat")}
              </NavLink>
            </>
          ) : null}
        </span>
      </div>
      {stale ? (
        <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t("postings.analysis.stale", { date: formatDate(latest.createdAt, tz) })}</span>
          <Button type="button" size="sm" onClick={() => void start()} disabled={busy}>
            {t("postings.analysis.reanalyze")}
          </Button>
        </Alert>
      ) : null}
      <p className="text-sm">{a.summary}</p>
      <div>
        <p className="mb-1 text-sm font-medium">{t("postings.analysis.fit")}</p>
        <ul aria-label={t("postings.analysis.fit")} className="flex flex-col gap-1 text-sm">
          {a.profiles.map((p) => (
            <li key={p.profileId} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{nameOf(p.profileId)}</span>
              <Badge tone={p.fit >= 70 ? "ok" : p.fit >= 50 ? "warn" : "danger"}>{p.fit}%</Badge>
              {p.profileId === a.recommendedProfileId ? (
                <Badge tone="info">{t("postings.analysis.recommended")}</Badge>
              ) : null}
              <span className="text-xs text-muted-fg">
                {t(`postings.analysis.confidence.${p.confidence}` as TKey)} · {p.rationale}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-fg">{a.recommendationRationale}</p>
      </div>
      <List
        title={t("postings.analysis.matches")}
        items={a.matches}
        render={(m) => (
          <>
            {m.requirement}{" "}
            <span className="text-xs text-muted-fg">
              ({t(`postings.analysis.strength.${m.strength}` as TKey)} · {ev(m.evidence)})
            </span>
          </>
        )}
      />
      <List
        title={t("postings.analysis.gaps")}
        items={[...a.gaps].sort(
          (x, y) =>
            ["blocking", "important", "minor"].indexOf(x.severity) -
            ["blocking", "important", "minor"].indexOf(y.severity),
        )}
        render={(g) => (
          <>
            <Badge
              tone={
                g.severity === "blocking"
                  ? "danger"
                  : g.severity === "important"
                    ? "warn"
                    : "neutral"
              }
            >
              {t(`postings.analysis.severity.${g.severity}` as TKey)}
            </Badge>{" "}
            {g.requirement} — <span className="text-muted-fg">{g.suggestion}</span>
          </>
        )}
      />
      <List
        title={t("postings.analysis.risks")}
        items={a.risks}
        render={(r) => (
          <>
            <span className="text-xs text-muted-fg">
              {t(`postings.riskType.${r.type}` as TKey)}:
            </span>{" "}
            {r.description}
          </>
        )}
      />
      <List
        title={t("postings.analysis.ats")}
        items={a.atsKeywordsMissing}
        render={(k) => (
          <>
            {k.term} <span className="text-xs text-muted-fg">({k.where})</span>
          </>
        )}
      />
      <List
        title={t("postings.analysis.questions")}
        items={a.likelyQuestions}
        render={(q) => (
          <>
            {q.question} <span className="text-xs text-muted-fg">— {q.why}</span>
          </>
        )}
      />
      <List
        title={t("postings.analysis.study")}
        items={a.studyRecommendations}
        render={(s) => (
          <>
            {s.topic} <span className="text-xs text-muted-fg">— {s.why}</span>
          </>
        )}
      />
      <List
        title={t("postings.analysis.cv")}
        items={a.cvImprovements}
        render={(c) => (
          <>
            {c.suggestion} <span className="text-xs text-muted-fg">— {c.why}</span>
          </>
        )}
      />
      {a.seniority.note ? (
        <p className="text-sm">
          <span className="font-medium">{t("postings.analysis.seniority")}:</span>{" "}
          {a.seniority.note}
        </p>
      ) : null}
      {analyses.length > 1 ? (
        <p className="text-xs text-muted-fg">
          {t("postings.analysis.history", { count: analyses.length - 1 })}
        </p>
      ) : null}
      {!stale ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void start()}
            disabled={busy}
          >
            {t("postings.analysis.reanalyze")}
          </Button>
        </div>
      ) : null}
      {dialog}
    </Card>
  );
}
