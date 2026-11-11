import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useApi } from "../../app/context";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { t } from "../../i18n";

const key = ["mail", "settings"] as const;
const OPTIONS = [7, 30, 90] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * F14/M2 · janela da primeira leitura (pedido do dono): quanto tempo para trás ler na primeira vez; depois, o resumo
 * do que já foi lido e a opção de ler mais para trás.
 */
export function MailWindow() {
  const api = useApi();
  const qc = useQueryClient();
  const id = useId();
  const q = useQuery({ queryKey: key, queryFn: () => api.getMailSettings() });
  const [choice, setChoice] = useState<string>("30");
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (since: string) => api.putMailSettings(since),
    onSuccess: (s) => {
      qc.setQueryData(key, s);
      setEditing(false);
    },
  });
  const s = q.data;
  if (!s) return null;
  const sinceIso = () =>
    choice === "custom"
      ? new Date(`${date}T00:00:00`).toISOString()
      : new Date(Date.now() - Number(choice) * 86_400_000).toISOString();
  if (s.since && !editing) {
    const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p>{t("integrations.gmail.windowSince", { date: day(s.since) })}</p>
        <p>
          {s.lastSyncAt
            ? t("integrations.gmail.lastSync", { date: when(s.lastSyncAt) })
            : t("integrations.gmail.neverSynced")}
        </p>
        <p>{t("integrations.gmail.totals", { total, pending: s.counts.pending ?? 0 })}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("integrations.gmail.extend")}
          </Button>
          <a href="/processos" className="self-center text-xs underline">
            {t("integrations.gmail.runs")}
          </a>
        </div>
      </div>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{t("integrations.gmail.windowTitle")}</legend>
      <p className="text-xs text-muted-fg">{t("integrations.gmail.windowHint")}</p>
      {OPTIONS.map((n) => (
        <label key={n} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={id}
            value={String(n)}
            checked={choice === String(n)}
            onChange={() => setChoice(String(n))}
          />
          {t("integrations.gmail.windowDays", { n })}
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={id}
          value="custom"
          checked={choice === "custom"}
          onChange={() => setChoice("custom")}
        />
        {t("integrations.gmail.windowCustom")}
      </label>
      {choice === "custom" ? (
        <Input
          type="date"
          aria-label={t("integrations.gmail.windowCustom")}
          className="w-44"
          min={new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)}
          max={new Date().toISOString().slice(0, 10)}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      ) : null}
      {save.error ? <p className="text-xs text-danger">{(save.error as Error).message}</p> : null}
      <div>
        <Button
          size="sm"
          disabled={save.isPending || (choice === "custom" && !date)}
          onClick={() => save.mutate(sinceIso())}
        >
          {t("integrations.gmail.windowSave")}
        </Button>
      </div>
    </fieldset>
  );
}
