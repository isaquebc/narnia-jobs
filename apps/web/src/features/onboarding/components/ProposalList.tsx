import {
  BENEFIT_LABELS,
  BENEFITS,
  type Benefit,
  CONTRACT_TYPE_LABELS,
  type Compensation,
  type FactKind,
  type FactProposal,
  formatCompensation,
} from "@narnia-jobs/shared";
import { useMemo, useState } from "react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Field } from "../../../components/ui/field";
import { Input, Select } from "../../../components/ui/input";
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
  "project",
];

export function proposalSummary(p: FactProposal): string {
  switch (p.kind) {
    case "identity":
      return (
        [
          p.data.fullName ?? p.data.displayName,
          p.data.email,
          p.data.phoneRaw,
          p.data.city,
          p.data.region,
          p.data.country,
          ...(p.data.links ?? []).map((l) => `${l.label} · ${l.url}`),
        ]
          .filter(Boolean)
          .join(" · ") || t("review.identityEmpty")
      );
    case "experience": {
      const d = p.data;
      const base = `${d.title} · ${d.company} · ${d.startDate}${d.isCurrent ? "–" : d.endDate ? `–${d.endDate}` : ""}`;
      const contract = [
        d.employmentType ? CONTRACT_TYPE_LABELS[d.employmentType] : null,
        d.weeklyHours ? `${d.weeklyHours} h/semana` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const benefits = [
        ...(d.benefits ?? []).map((b) => BENEFIT_LABELS[b]),
        ...(d.benefitsOther ?? []),
      ];
      return [
        base,
        contract,
        d.compensation ? formatCompensation(d.compensation, d.weeklyHours) : "",
        benefits.length ? t("review.exp.summaryBenefits", { list: benefits.join(", ") }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
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
    case "project":
      return p.data.name;
    default:
      return "";
  }
}

/** Campos da experiência com controle próprio na edição (contrato, carga, salário, benefícios). */
const EXPERIENCE_OWN_FIELDS = new Set(["employmentType", "weeklyHours"]);

function editableFields(kind: FactKind, data: Record<string, unknown>): string[] {
  return Object.entries(data)
    .filter(
      ([k, v]) =>
        (typeof v === "string" || typeof v === "number") &&
        !(kind === "experience" && EXPERIENCE_OWN_FIELDS.has(k)),
    )
    .map(([k]) => k);
}

/** Contrato, carga horária, salário e benefícios da experiência (campos opcionais, pedido do dono 2026-10-13). */
function ExperienceExtraFields({
  id,
  draft,
  setDraft,
}: {
  id: string;
  draft: Record<string, unknown>;
  setDraft: (fn: (d: Record<string, unknown>) => Record<string, unknown>) => void;
}) {
  const comp = draft.compensation as Compensation | undefined;
  const [amount, setAmount] = useState(comp ? String(comp.amount) : "");
  const [period, setPeriod] = useState<Compensation["period"]>(comp?.period ?? "monthly");
  const [currency, setCurrency] = useState(comp?.currency ?? "BRL");
  const benefits = (draft.benefits as Benefit[] | undefined) ?? [];
  const [other, setOther] = useState(
    ((draft.benefitsOther as string[] | undefined) ?? []).join(", "),
  );
  const setComp = (a: string, p: Compensation["period"], c: string) =>
    setDraft((d) => {
      const n = Number(a.replace(",", "."));
      const { compensation: _c, ...rest } = d;
      return a.trim() && Number.isFinite(n) && n > 0
        ? { ...rest, compensation: { amount: n, period: p, currency: c.trim().toUpperCase() } }
        : rest;
    });
  return (
    <>
      <Field label={t("review.exp.employmentType")} htmlFor={`edit-${id}-employmentType`}>
        <Select
          id={`edit-${id}-employmentType`}
          value={String(draft.employmentType ?? "")}
          onChange={(e) =>
            setDraft((d) => {
              const { employmentType: _e, ...rest } = d;
              return e.target.value ? { ...rest, employmentType: e.target.value } : rest;
            })
          }
        >
          <option value="">{t("review.exp.notInformed")}</option>
          {Object.entries(CONTRACT_TYPE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("review.exp.weeklyHours")} htmlFor={`edit-${id}-weeklyHours`}>
        <Input
          id={`edit-${id}-weeklyHours`}
          type="number"
          min={1}
          max={80}
          value={draft.weeklyHours === undefined ? "" : String(draft.weeklyHours)}
          onChange={(e) =>
            setDraft((d) => {
              const { weeklyHours: _w, ...rest } = d;
              return e.target.value ? { ...rest, weeklyHours: Number(e.target.value) } : rest;
            })
          }
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t("review.exp.salaryAmount")} htmlFor={`edit-${id}-salary`}>
          <Input
            id={`edit-${id}-salary`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setComp(e.target.value, period, currency);
            }}
          />
        </Field>
        <Field label={t("review.exp.salaryPeriod")} htmlFor={`edit-${id}-period`}>
          <Select
            id={`edit-${id}-period`}
            value={period}
            onChange={(e) => {
              const p = e.target.value as Compensation["period"];
              setPeriod(p);
              setComp(amount, p, currency);
            }}
          >
            {(["hourly", "monthly", "yearly"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`review.exp.period.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("review.exp.currency")} htmlFor={`edit-${id}-currency`}>
          <Input
            id={`edit-${id}-currency`}
            maxLength={3}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value.toUpperCase());
              setComp(amount, period, e.target.value);
            }}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{t("review.exp.benefits")}</legend>
        <div className="grid grid-cols-2 gap-1">
          {BENEFITS.map((b) => (
            <label key={b} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={benefits.includes(b)}
                onChange={(e) =>
                  setDraft((d) => {
                    const cur = (d.benefits as Benefit[] | undefined) ?? [];
                    return {
                      ...d,
                      benefits: e.target.checked ? [...cur, b] : cur.filter((x) => x !== b),
                    };
                  })
                }
              />
              {BENEFIT_LABELS[b]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t("review.exp.benefitsOther")} htmlFor={`edit-${id}-benefitsOther`}>
        <Input
          id={`edit-${id}-benefitsOther`}
          value={other}
          onChange={(e) => {
            setOther(e.target.value);
            const list = e.target.value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            setDraft((d) => ({ ...d, benefitsOther: list }));
          }}
        />
      </Field>
    </>
  );
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
          {editableFields(item.proposal.kind, data).map((key) => (
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
          {item.proposal.kind === "experience" ? (
            <ExperienceExtraFields id={item.id} draft={draft} setDraft={setDraft} />
          ) : null}
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
