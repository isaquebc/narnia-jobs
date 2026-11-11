import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useApi } from "../../app/context";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { t } from "../../i18n";

const key = ["mail", "feed-settings"] as const;
const FIELDS = [
  { name: "preanalysisCut", max: 100 },
  { name: "preanalysisDailyCap", max: 100 },
  { name: "linksPerRun", max: 1000 },
] as const;

/** F14-6, F14-7, F14-10 · feed: corte e teto da pré-análise automática e quantos links abrir por execução. */
export function MailFeedSettings() {
  const api = useApi();
  const qc = useQueryClient();
  const id = useId();
  const q = useQuery({ queryKey: key, queryFn: () => api.getFeedSettings() });
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setForm(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, String(v)])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api.putFeedSettings(Object.fromEntries(FIELDS.map((f) => [f.name, Number(form[f.name])]))),
    onSuccess: (s) => qc.setQueryData(key, s),
  });
  if (!q.data) return null;
  const valid = FIELDS.every((f) => {
    const n = Number(form[f.name]);
    return Number.isInteger(n) && n >= 0 && n <= f.max;
  });
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <h4 id={id} className="text-sm font-semibold">
        {t("integrations.gmail.feed.title")}
      </h4>
      <div className="flex flex-wrap gap-3">
        {FIELDS.map((f) => (
          <div key={f.name} className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-${f.name}`}>{t(`integrations.gmail.feed.${f.name}`)}</label>
            <Input
              id={`${id}-${f.name}`}
              type="number"
              min={0}
              max={f.max}
              className="w-28"
              value={form[f.name] ?? ""}
              onChange={(e) => setForm((x) => ({ ...x, [f.name]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate()}
        >
          {t("integrations.gmail.feed.save")}
        </Button>
      </div>
    </section>
  );
}
