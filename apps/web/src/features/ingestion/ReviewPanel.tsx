import type { CheckStatus, Conflict, Resolution, ReviewRequest } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApi } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { liveErrorOf } from "../../hooks/useChat";
import { ingestionKey } from "../../hooks/useIngestion";
import { useProfiles } from "../../hooks/useProfiles";
import { type TKey, t } from "../../i18n";
import type { IngestionDetail } from "../../lib/api";
import { type SessionLimit, SessionLimitDialog, sessionLimitOf } from "../chat/SessionLimitDialog";
import { proposalSummary } from "../onboarding/components/ProposalList";
import { FriendlyError } from "./FriendlyError";

type Proposal = IngestionDetail["proposals"][number];
type Choice = "keep" | "use_new" | "edit";
interface LocalDecision {
  decision: "accepted" | "rejected";
  resolution: Record<string, { choice?: Choice; value?: string }>;
  profiles: string[];
}
type Filter = "all" | "new" | "existing" | "conflict" | "pending" | "unsupported";
const FILTERS: Filter[] = ["all", "new", "existing", "conflict", "pending", "unsupported"];
/** Tipos que aceitam destaque por perfil (tags da revisão, F03 §2.8). */
const TAGGABLE = new Set([
  "experience",
  "project",
  "skill",
  "education",
  "language",
  "achievement",
]);
const CHECK_TONE: Record<CheckStatus, "ok" | "warn" | "danger" | "neutral"> = {
  supported: "ok",
  partial: "warn",
  unsupported: "danger",
  unchecked: "neutral",
};
const MATCH_TONE = { new: "info", existing: "neutral", conflict: "warn" } as const;

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function resolved(
  conflict: Conflict | null | undefined,
  local: LocalDecision | undefined,
): boolean {
  if (!conflict || local?.decision !== "accepted") return true;
  return conflict.fields.every((f) => {
    const r = local.resolution[f.field];
    if (!r?.choice) return false;
    return r.choice !== "edit" || Boolean(r.value?.trim());
  });
}

function ConflictResolver({
  conflict,
  value,
  onChange,
}: {
  conflict: Conflict;
  value: LocalDecision["resolution"];
  onChange: (field: string, r: { choice?: Choice; value?: string }) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warn/50 bg-warn/5 p-2">
      {conflict.fields.map((f) => {
        const r = value[f.field] ?? {};
        const name = `resolve-${conflict.targetId}-${f.field}`;
        return (
          <fieldset
            key={f.field}
            aria-label={t("review3.resolve", { field: f.field })}
            className="flex flex-col gap-1"
          >
            <legend className="text-xs font-medium">
              {t("review3.resolve", { field: f.field })}
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={name}
                checked={r.choice === "keep"}
                onChange={() => onChange(f.field, { choice: "keep" })}
              />
              {t("review3.keep", { value: show(f.current) })}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={name}
                checked={r.choice === "use_new"}
                onChange={() => onChange(f.field, { choice: "use_new" })}
              />
              {t("review3.useNew", { value: show(f.proposed) })}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={name}
                checked={r.choice === "edit"}
                onChange={() => onChange(f.field, { choice: "edit", value: r.value ?? "" })}
              />
              {t("review3.edit")}
            </label>
            {r.choice === "edit" ? (
              <Input
                aria-label={t("review3.editValue", { field: f.field })}
                value={r.value ?? ""}
                onChange={(e) => onChange(f.field, { choice: "edit", value: e.target.value })}
                className="w-64"
              />
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Revisão estendida (F03 §4): filtros novo/existente/conflito/pendente/sem suporte, selo da revisão anti-alucinação
 * com o trecho de evidência, resolução de conflito campo a campo (salvar fica bloqueado até resolver os aceitos) e
 * tags por perfil por linha e em lote. "Clarificar com o recrutador" abre uma conversa de clarificação (F04).
 */
export function ReviewPanel({ run }: { run: IngestionDetail }) {
  const api = useApi();
  const qc = useQueryClient();
  const { profiles } = useProfiles();
  const navigate = useNavigate();
  // F04: a clarificação abre uma conversa ligada a esta execução; as propostas novas voltam para esta revisão
  const [limit, setLimit] = useState<SessionLimit | null>(null);
  const clarify = useMutation({
    mutationFn: () => api.clarifyIngestion(run.id),
    onSuccess: (r) => void navigate({ to: `/chat/${r.session.id}` as string }),
    // teto de conversas = diálogo; qualquer outro erro aparece em linguagem simples (auditoria D)
    onError: (e) => setLimit(sessionLimitOf(e)),
  });
  const closeAndClarify = async (id: string) => {
    await api.hibernateChat(id);
    setLimit(null);
    clarify.mutate();
  };
  const proposals = run.proposals;
  const [filter, setFilter] = useState<Filter>("all");
  const [local, setLocal] = useState<Record<string, LocalDecision>>({});
  const [bulkProfiles, setBulkProfiles] = useState<string[]>([]);
  const [rowProfiles, setRowProfiles] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(proposals.map((p) => [p.id, p.suggestedProfiles ?? []])),
  );

  const pending = (p: Proposal) => p.decision === "pending" && !local[p.id];
  const matches = (p: Proposal, f: Filter) => {
    switch (f) {
      case "all":
        return true;
      case "pending":
        return pending(p);
      case "unsupported":
        return p.checkStatus === "unsupported";
      default:
        return (p.match ?? "new") === f;
    }
  };
  const visible = proposals.filter((p) => matches(p, filter));
  const decide = (p: Proposal, decision: "accepted" | "rejected" | null) =>
    setLocal((cur) => {
      const next = { ...cur };
      if (decision === null) delete next[p.id];
      else next[p.id] = { decision, resolution: cur[p.id]?.resolution ?? {}, profiles: [] };
      return next;
    });
  const unresolved = proposals.some((p) => !resolved(p.conflict, local[p.id]));
  const decided = proposals.filter((p) => p.decision === "pending" && local[p.id]);

  const body = useMemo((): ReviewRequest => {
    const decisions = decided.map((p) => {
      const d = local[p.id] as LocalDecision;
      if (d.decision === "rejected") return { proposalId: p.id, decision: "rejected" as const };
      const tags = TAGGABLE.has(p.proposal.kind)
        ? [...new Set([...(rowProfiles[p.id] ?? []), ...bulkProfiles])]
        : [];
      const resolution: Resolution | undefined = p.conflict
        ? Object.fromEntries(
            p.conflict.fields.map((f) => {
              const r = d.resolution[f.field] ?? {};
              return [
                f.field,
                r.choice === "edit"
                  ? { choice: "edit", value: r.value }
                  : { choice: r.choice as Choice },
              ];
            }),
          )
        : undefined;
      return {
        proposalId: p.id,
        decision: "accepted" as const,
        ...(tags.length ? { profiles: tags } : {}),
        ...(resolution ? { resolution } : {}),
      };
    });
    return { decisions } as ReviewRequest;
  }, [decided, local, rowProfiles, bulkProfiles]);

  const save = useMutation({
    mutationFn: () => api.reviewIngestion(run.id, body),
    onSuccess: () => {
      setLocal({});
      void qc.invalidateQueries({ queryKey: ingestionKey(run.id) });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const count = (f: Filter) => proposals.filter((p) => matches(p, f)).length;
  const toggleRowProfile = (pid: string, profileId: string) =>
    setRowProfiles((cur) => {
      const list = cur[pid] ?? [];
      return {
        ...cur,
        [pid]: list.includes(profileId)
          ? list.filter((x) => x !== profileId)
          : [...list, profileId],
      };
    });

  return (
    <section aria-label={t("review3.title")} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("review3.title")}</h2>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">{t("review3.filterLegend")}</legend>
        {FILTERS.map((f) => (
          <label key={f} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name="review-filter"
              checked={filter === f}
              onChange={() => setFilter(f)}
            />
            {t(`review3.filters.${f}` as TKey, { count: count(f) })}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            proposals.filter(pending).forEach((p) => {
              decide(p, "accepted");
            })
          }
        >
          {t("review.acceptAll")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            proposals.filter(pending).forEach((p) => {
              decide(p, "rejected");
            })
          }
        >
          {t("review.rejectAll")}
        </Button>
        {profiles.map((pr) => (
          <label key={pr.id} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={bulkProfiles.includes(pr.id)}
              onChange={() =>
                setBulkProfiles((cur) =>
                  cur.includes(pr.id) ? cur.filter((x) => x !== pr.id) : [...cur, pr.id],
                )
              }
            />
            {t("review3.bulkTag", { name: pr.name })}
          </label>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {visible.map((p) => {
          const d = local[p.id];
          const current = d?.decision ?? (p.decision === "pending" ? "pending" : p.decision);
          const summary = proposalSummary(p.proposal);
          const check = p.checkStatus ?? "unchecked";
          return (
            <li
              key={p.id}
              aria-label={summary}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm">{summary}</span>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={MATCH_TONE[p.match ?? "new"]}>
                      {t(`review3.match.${p.match ?? "new"}` as TKey)}
                    </Badge>
                    <Badge tone={CHECK_TONE[check]}>{t(`review3.check.${check}` as TKey)}</Badge>
                    <span className="text-muted-fg">
                      {t(`review.kinds.${p.proposal.kind}` as TKey)}
                    </span>
                    {current !== "pending" ? (
                      <Badge tone={current === "rejected" ? "danger" : "ok"}>
                        {t(`review.${current === "rejected" ? "reject" : "accept"}` as TKey)}
                      </Badge>
                    ) : null}
                  </div>
                  {p.evidence ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-fg">
                        {t("review3.evidence")}
                      </summary>
                      <blockquote className="mt-1 border-l-2 border-border pl-2">{`“${p.evidence.quote}”`}</blockquote>
                      <span className="text-muted-fg">{p.evidence.ref}</span>
                    </details>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {p.decision === "pending" ? (
                    d ? (
                      <Button size="sm" variant="ghost" onClick={() => decide(p, null)}>
                        {t("review.undo")}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => decide(p, "accepted")}>
                          {t("review.accept")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => decide(p, "rejected")}>
                          {t("review.reject")}
                        </Button>
                      </>
                    )
                  ) : null}
                </div>
              </div>
              {p.conflict && d?.decision === "accepted" ? (
                <ConflictResolver
                  conflict={p.conflict}
                  value={d.resolution}
                  onChange={(field, r) =>
                    setLocal((cur) => {
                      const prev = cur[p.id] as LocalDecision;
                      return {
                        ...cur,
                        [p.id]: { ...prev, resolution: { ...prev.resolution, [field]: r } },
                      };
                    })
                  }
                />
              ) : null}
              {TAGGABLE.has(p.proposal.kind) && p.decision === "pending" && profiles.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {profiles.map((pr) => (
                    <label key={pr.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={(rowProfiles[p.id] ?? []).includes(pr.id)}
                        onChange={() => toggleRowProfile(p.id, pr.id)}
                      />
                      {t("review3.tag", { name: pr.name })}
                    </label>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {unresolved ? <Alert tone="warn">{t("review3.unresolved")}</Alert> : null}
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
      <div className="flex items-center gap-2">
        <Button
          disabled={decided.length === 0 || unresolved || save.isPending}
          onClick={() => save.mutate()}
        >
          {t("review3.save")}
        </Button>
        <Button variant="outline" disabled={clarify.isPending} onClick={() => clarify.mutate()}>
          {t("review.clarify")}
        </Button>
        <SessionLimitDialog
          limit={limit}
          onChoose={(id) => void closeAndClarify(id)}
          onCancel={() => setLimit(null)}
        />
      </div>
      {clarify.isError && !sessionLimitOf(clarify.error) ? (
        <Alert tone="danger">
          <FriendlyError error={toFriendly(clarify.error)} />
        </Alert>
      ) : null}
    </section>
  );
}

function toFriendly(e: unknown) {
  const { key, technical } = liveErrorOf(e);
  const k = key ?? "error.unknown";
  return { key: k as never, hint: `${k}_hint` as never, technical };
}
