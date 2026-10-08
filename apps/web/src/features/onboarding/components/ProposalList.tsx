import type { FactKind, FactProposal } from "@narnia-jobs/shared";
import { useMemo, useState } from "react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Field } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { type TKey, t } from "../../../i18n";
import { type Origin, ReadingOriginBadge } from "./ReadingOriginBadge";

export type DecisionValue = "accepted" | "edited" | "rejected";
export interface Decision {
  decision: DecisionValue;
  editedData?: Record<string, unknown>;
}
export interface ProposalItem {
  id: string;
  proposal: FactProposal;
  decision: "pending" | DecisionValue;
  origin: Origin | null;
  divergent?: boolean;
}

const KIND_ORDER: FactKind[] = [
  "identity",
  "experience",
  "achievement",
  "education",
  "skill",
  "language",
  "link",
];

export function proposalSummary(p: FactProposal): string {
  switch (p.kind) {
    case "identity":
      return [p.data.fullName ?? p.data.displayName, p.data.email, p.data.city]
        .filter(Boolean)
        .join(" · ");
    case "experience":
      return `${p.data.title} · ${p.data.company} · ${p.data.startDate}${p.data.isCurrent ? "–" : p.data.endDate ? `–${p.data.endDate}` : ""}`;
    case "achievement":
      return p.data.metric ? `${p.data.text} (${p.data.metric})` : p.data.text;
    case "education":
      return `${p.data.course} · ${p.data.institution}`;
    case "skill":
      return p.data.name;
    case "language":
      return `${p.data.name} · ${p.data.level}`;
    case "link":
      return `${p.data.label} · ${p.data.url}`;
    default:
      return "";
  }
}

function editableFields(data: Record<string, unknown>): string[] {
  return Object.entries(data)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k]) => k);
}

export function ProposalRow({
  item,
  decision,
  onDecide,
}: {
  item: ProposalItem;
  decision: Decision | undefined;
  onDecide: (
    id: string,
    decision: DecisionValue | "pending",
    editedData?: Record<string, unknown>,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const data = item.proposal.data as Record<string, unknown>;
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...data });
  const current = decision?.decision ?? "pending";
  const tone =
    current === "accepted" || current === "edited"
      ? "ok"
      : current === "rejected"
        ? "danger"
        : "neutral";
  return (
    <li
      data-testid={`proposal-${item.id}`}
      className={`flex items-center justify-between gap-3 rounded-md border border-border p-3 ${current === "rejected" ? "opacity-60" : ""}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm">
          {proposalSummary(
            decision?.editedData
              ? ({ ...item.proposal, data: { ...data, ...decision.editedData } } as FactProposal)
              : item.proposal,
          )}
        </span>
        <div className="flex items-center gap-2 text-xs text-muted-fg">
          <span>{t("review.confidence", { pct: Math.round(item.proposal.confidence * 100) })}</span>
          <ReadingOriginBadge origin={item.origin} divergent={item.divergent} />
          {current === "edited" ? <Badge tone="ok">{t("review.edited")}</Badge> : null}
          {current !== "pending" && current !== "edited" ? (
            <Badge tone={tone}>
              {t(`review.${current === "accepted" ? "accept" : "reject"}` as TKey)}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {current === "pending" ? (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onDecide(item.id, "accepted", undefined)}
            >
              {t("review.accept")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t("review.edit")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDecide(item.id, "rejected", undefined)}
            >
              {t("review.reject")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onDecide(item.id, "pending", undefined)}>
            {t("review.undo")}
          </Button>
        )}
      </div>
      <Dialog open={editing} onOpenChange={setEditing} title={t("review.editDialog.title")}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onDecide(item.id, "edited", draft);
            setEditing(false);
          }}
        >
          {editableFields(data).map((key) => (
            <Field key={key} label={key} htmlFor={`edit-${item.id}-${key}`}>
              <Input
                id={`edit-${item.id}-${key}`}
                aria-label={key}
                value={String(draft[key] ?? "")}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [key]: typeof data[key] === "number" ? Number(e.target.value) : e.target.value,
                  }))
                }
              />
            </Field>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>
              {t("app.cancel")}
            </Button>
            <Button type="submit">{t("review.editDialog.save")}</Button>
          </div>
        </form>
      </Dialog>
    </li>
  );
}

export function ProposalList({
  proposals,
  decisions,
  onDecide,
}: {
  proposals: ProposalItem[];
  decisions: Record<string, Decision>;
  onDecide: (
    id: string,
    decision: DecisionValue | "pending",
    editedData?: Record<string, unknown>,
  ) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<FactKind, ProposalItem[]>();
    for (const p of proposals) {
      const list = map.get(p.proposal.kind) ?? [];
      list.push(p);
      map.set(p.proposal.kind, list);
    }
    return KIND_ORDER.filter((k) => map.has(k)).map(
      (k) => [k, map.get(k) as ProposalItem[]] as const,
    );
  }, [proposals]);
  const pending = proposals.filter(
    (p) => !decisions[p.id] || decisions[p.id]?.decision === undefined,
  );
  const bulk = (decision: DecisionValue) => {
    for (const p of pending) onDecide(p.id, decision, undefined);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-fg">
          {pending.length > 0
            ? t("review.pending", { count: pending.length })
            : t("review.allDecided")}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk("accepted")}
            disabled={pending.length === 0}
          >
            {t("review.acceptAll")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk("rejected")}
            disabled={pending.length === 0}
          >
            {t("review.rejectAll")}
          </Button>
        </div>
      </div>
      {groups.map(([kind, items]) => (
        <section key={kind} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t(`review.kinds.${kind}` as TKey)}</h3>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <ProposalRow
                key={item.id}
                item={item}
                decision={decisions[item.id]}
                onDecide={onDecide}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
