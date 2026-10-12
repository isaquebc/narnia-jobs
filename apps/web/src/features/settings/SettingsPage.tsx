import type { BudgetUnit } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { t } from "../../i18n";
import type { IngestSettings } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { GithubConnectCard } from "../ingestion/github/GithubConnectCard";
import { bytesLabel } from "../ingestion/units";
import { ChatSettingsSection } from "./ChatSettingsSection";

const GB = 1024 ** 3;
const DEPTHS = ["quick", "balanced", "deep"] as const;

interface Form {
  reviewCheckModelEnabled: boolean;
  autoConfirm: string;
  budgetUnit: BudgetUnit;
  budget: Record<(typeof DEPTHS)[number], string>;
  snapshotsGb: string;
}

const toForm = (s: IngestSettings): Form => ({
  reviewCheckModelEnabled: s.reviewCheckModelEnabled,
  autoConfirm: String(s.autoConfirmBelow / 1000),
  budgetUnit: s.budgetUnit,
  budget: {
    quick: String(s.budgetDefaults.quick / 1000),
    balanced: String(s.budgetDefaults.balanced / 1000),
    deep: String(s.budgetDefaults.deep / 1000),
  },
  snapshotsGb: String(s.snapshotsMaxBytes / GB),
});

const k = (v: string) => Math.max(0, Math.round(Number(v) * 1000) || 0);

function Snapshots() {
  const api = useApi();
  const qc = useQueryClient();
  const snaps = useQuery({ queryKey: ["snapshots"], queryFn: () => api.listSnapshots() });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSnapshot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshots"] }),
  });
  // correções F03, item 15: acima do teto, aviso e poda dos menos usados até caber
  const prune = useMutation({
    mutationFn: () => api.pruneSnapshots(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshots"] }),
  });
  if (!snaps.data) return null;
  const overCap = snaps.data.maxBytes > 0 && snaps.data.totalBytes > snaps.data.maxBytes;
  return (
    <section aria-label={t("settings.snapshots.title")} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("settings.snapshots.title")}</h3>
      <span className="text-sm">
        {t("settings.snapshots.usage", {
          used: bytesLabel(snaps.data.totalBytes),
          max: bytesLabel(snaps.data.maxBytes),
        })}
      </span>
      {overCap ? (
        <Alert tone="warn" className="flex flex-col gap-2">
          <span>{t("settings.snapshots.overCap")}</span>
          <div>
            <Button size="sm" disabled={prune.isPending} onClick={() => prune.mutate()}>
              {t("settings.snapshots.prune")}
            </Button>
          </div>
        </Alert>
      ) : null}
      {snaps.data.snapshots.length > 0 ? (
        <span className="text-xs text-muted-fg">{t("settings.snapshots.order")}</span>
      ) : null}
      {snaps.data.snapshots.length === 0 ? (
        <span className="text-sm text-muted-fg">{t("settings.snapshots.empty")}</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {snaps.data.snapshots.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {s.ref} · {bytesLabel(s.size)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("settings.snapshots.delete", { ref: s.ref })}
                onClick={() => remove.mutate(s.id)}
              >
                {t("settings.snapshots.deleteShort")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Backups (F03-fix L1, FX-2): teto total e o mais recente. */
function Backups() {
  const api = useApi();
  const tz = useTimezone();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings", "backups"], queryFn: () => api.getBackupSettings() });
  const [max, setMax] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (n: number) => api.putBackupSettings({ max: n }),
    onSuccess: (r) => qc.setQueryData(["settings", "backups"], r),
  });
  if (!q.data) return null;
  const value = max ?? String(q.data.max);
  return (
    <section aria-label={t("settings.backups.title")} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("settings.backups.title")}</h3>
      {!q.data.enabled ? (
        <span className="text-sm text-muted-fg">{t("settings.backups.disabled")}</span>
      ) : q.data.latest ? (
        <span className="text-sm">
          {t("settings.backups.latest", {
            date: formatDate(q.data.latest.at, tz),
            count: q.data.count,
          })}
        </span>
      ) : (
        <span className="text-sm text-muted-fg">{t("settings.backups.none")}</span>
      )}
      <Field
        label={t("settings.backups.max")}
        htmlFor="backups-max"
        hint={t("settings.backups.maxHint")}
      >
        <Input
          id="backups-max"
          type="number"
          min={1}
          value={value}
          onChange={(e) => {
            save.reset();
            setMax(e.target.value);
          }}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => save.mutate(Math.max(1, Math.round(Number(value)) || 1))}
          disabled={save.isPending}
        >
          {t("settings.backups.save")}
        </Button>
        {save.isSuccess ? <span className="text-sm">{t("settings.backups.saved")}</span> : null}
      </div>
    </section>
  );
}

/** Configurações › Integrações (F03 §4): credencial do GitHub, revisor, autoconfirmação, orçamento e snapshots. */
export function SettingsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "ingest"],
    queryFn: () => api.getIngestSettings(),
  });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(toForm(settings.data));
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (f: Form) =>
      api.putIngestSettings({
        reviewCheckModelEnabled: f.reviewCheckModelEnabled,
        autoConfirmBelow: k(f.autoConfirm),
        budgetUnit: f.budgetUnit,
        budgetDefaults: {
          quick: k(f.budget.quick),
          balanced: k(f.budget.balanced),
          deep: k(f.budget.deep),
        },
        snapshotsMaxBytes: Math.max(0, Math.round(Number(f.snapshotsGb) * GB) || 0),
      }),
    onSuccess: (s) => {
      qc.setQueryData(["settings", "ingest"], s);
      void qc.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });
  const set = (patch: Partial<Form>) => {
    save.reset();
    setForm((f) => (f ? { ...f, ...patch } : f));
  };
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
      <h2 className="text-base font-semibold">{t("settings.integrations")}</h2>
      <GithubConnectCard />
      <ChatSettingsSection />
      {form ? (
        <Card className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold">{t("settings.ingest")}</h3>
          <div className="flex items-center gap-3">
            <Switch
              id="review-check"
              checked={form.reviewCheckModelEnabled}
              onCheckedChange={(v) => set({ reviewCheckModelEnabled: v })}
              label={t("settings.reviewCheck")}
            />
            <label htmlFor="review-check" className="text-sm">
              {t("settings.reviewCheck")}
            </label>
          </div>
          <Field
            label={t("settings.autoConfirm")}
            htmlFor="auto-confirm"
            hint={t("settings.autoConfirmHint")}
          >
            <Input
              id="auto-confirm"
              type="number"
              min={0}
              step="any"
              value={form.autoConfirm}
              onChange={(e) => set({ autoConfirm: e.target.value })}
              className="w-32"
            />
          </Field>
          <Field label={t("settings.budgetUnit")} htmlFor="budget-default-unit">
            <select
              id="budget-default-unit"
              value={form.budgetUnit}
              onChange={(e) => set({ budgetUnit: e.target.value as BudgetUnit })}
              className="h-10 w-48 rounded-md border border-border bg-card px-2 text-sm"
            >
              <option value="thousand">{t("budget.units.thousand")}</option>
              <option value="million">{t("budget.units.million")}</option>
              <option value="window_pct">{t("budget.units.window_pct")}</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-3">
            {DEPTHS.map((d) => (
              <Field
                key={d}
                label={t(`settings.budgetDefault.${d}`)}
                htmlFor={`budget-default-${d}`}
              >
                <Input
                  id={`budget-default-${d}`}
                  type="number"
                  min={0}
                  step="any"
                  value={form.budget[d]}
                  onChange={(e) => set({ budget: { ...form.budget, [d]: e.target.value } })}
                  className="w-32"
                />
              </Field>
            ))}
          </div>
          <Field label={t("settings.snapshotsCap")} htmlFor="snapshots-cap">
            <Input
              id="snapshots-cap"
              type="number"
              min={0}
              step="any"
              value={form.snapshotsGb}
              onChange={(e) => set({ snapshotsGb: e.target.value })}
              className="w-32"
            />
          </Field>
          {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
          {save.isSuccess ? <Alert tone="ok">{t("settings.saved")}</Alert> : null}
          <div>
            <Button disabled={save.isPending} onClick={() => save.mutate(form)}>
              {t("settings.save")}
            </Button>
          </div>
          <Snapshots />
          <Backups />
        </Card>
      ) : null}
    </div>
  );
}
