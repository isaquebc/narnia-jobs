import type { MailSendersView, MailSenderView } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useApi } from "../../app/context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { type TKey, t } from "../../i18n";

const key = ["mail", "senders"] as const;

/**
 * F14/M3 · lista de remetentes (F14-13): confiáveis e bloqueados, com adicionar e remover; sugestões pelo histórico;
 * ao confiar num remetente com e-mails em quarentena, oferece avaliar esses e-mails de novo.
 */
export function MailSenders() {
  const api = useApi();
  const qc = useQueryClient();
  const id = useId();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<{ value: string; n: number } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => api.listMailSenders() });
  const set = (s: MailSendersView) => qc.setQueryData(key, s);
  const put = useMutation({
    mutationFn: (v: { value: string; override: "trusted" | "blocked" }) => api.putMailSender(v),
    onSuccess: (r, v) => {
      set(r);
      setValue("");
      setDone(null);
      setPending(r.quarantined ? { value: v.value.trim().toLowerCase(), n: r.quarantined } : null);
    },
  });
  const del = useMutation({ mutationFn: (v: string) => api.deleteMailSender(v), onSuccess: set });
  const reprocess = useMutation({
    mutationFn: (v: string) => api.reprocessMailSender(v),
    onSuccess: (r) => {
      setPending(null);
      setDone(r.reprocessed);
    },
  });
  const s = q.data;
  if (!s) return null;
  const row = (x: MailSenderView) => (
    <li key={x.value} className="flex flex-wrap items-center gap-2 text-sm">
      <code className="rounded bg-muted px-1 text-xs">{x.value}</code>
      {x.overrideOrigin ? (
        <Badge>{t(`integrations.gmail.senders.origin.${x.overrideOrigin}` as TKey)}</Badge>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("integrations.gmail.senders.remove", { value: x.value })}
        onClick={() => del.mutate(x.value)}
      >
        ×
      </Button>
    </li>
  );
  const list = (title: string, items: MailSenderView[]) => (
    <div>
      <h5 className="text-xs font-semibold uppercase text-muted-fg">{title}</h5>
      {items.length ? (
        <ul aria-label={title} className="flex flex-col gap-1">
          {items.map(row)}
        </ul>
      ) : (
        <p className="text-xs text-muted-fg">{t("integrations.gmail.senders.none")}</p>
      )}
    </div>
  );
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <h4 id={id} className="text-sm font-semibold">
        {t("integrations.gmail.senders.title")}
      </h4>
      <p className="text-xs text-muted-fg">{t("integrations.gmail.senders.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("integrations.gmail.senders.value")}
          placeholder="rh@empresa.com ou @empresa.com"
          className="w-64"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!value.trim() || put.isPending}
          onClick={() => put.mutate({ value, override: "trusted" })}
        >
          {t("integrations.gmail.senders.trust")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!value.trim() || put.isPending}
          onClick={() => put.mutate({ value, override: "blocked" })}
        >
          {t("integrations.gmail.senders.block")}
        </Button>
      </div>
      {put.error ? <p className="text-xs text-danger">{(put.error as Error).message}</p> : null}
      {pending ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {t("integrations.gmail.senders.quarantined", { n: pending.n })}
          <Button size="sm" variant="secondary" onClick={() => reprocess.mutate(pending.value)}>
            {t("integrations.gmail.senders.reprocess")}
          </Button>
        </p>
      ) : null}
      {done !== null ? (
        <p className="text-sm">{t("integrations.gmail.senders.reprocessed", { n: done })}</p>
      ) : null}
      {list(t("integrations.gmail.senders.trusted"), s.trusted)}
      {list(t("integrations.gmail.senders.blocked"), s.blocked)}
      {s.suggestions.length ? (
        <div>
          <h5 className="text-xs font-semibold uppercase text-muted-fg">
            {t("integrations.gmail.senders.suggestions")}
          </h5>
          <ul className="flex flex-col gap-1">
            {s.suggestions.map((x) => (
              <li key={x.value} className="flex items-center gap-2 text-sm">
                <code className="rounded bg-muted px-1 text-xs">{x.value}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("integrations.gmail.senders.trustOne", { value: x.value })}
                  onClick={() => put.mutate({ value: x.value, override: "trusted" })}
                >
                  {t("integrations.gmail.senders.trust")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
