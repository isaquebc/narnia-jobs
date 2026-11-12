import type { PostingListItem } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "../../app/context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { type TKey, t } from "../../i18n";
import type { MailReviewItem } from "../../lib/api";
import { RereadMailButton } from "./RereadMailButton";

const key = ["mail", "review"] as const;
const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Escolher a vaga do e-mail: busca nas vagas salvas e liga com um clique. A busca já vem com a empresa (ou o cargo) do
 * e-mail, e as vagas com candidatura vêm primeiro, com o selo: a confirmação de uma candidatura já feita liga a ela
 * (pedido do dono 2026-11-12: as repetidas do feed escondiam a vaga aplicada).
 */
function PickPosting({
  initial,
  onPick,
}: {
  initial: string;
  onPick: (p: PostingListItem) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState(initial);
  const list = useQuery({
    queryKey: ["postings", "pick", q],
    queryFn: () => api.listPostings(q.trim()),
    enabled: q.trim().length >= 2,
  });
  const postings = [...(list.data?.postings ?? [])].sort(
    (a, b) => Number(!!b.application) - Number(!!a.application),
  );
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={t("mailReview.searchPosting")}
        placeholder={t("mailReview.searchPosting")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full sm:w-80"
      />
      {postings.slice(0, 10).map((p) => (
        <Button
          key={p.id}
          size="sm"
          variant="ghost"
          className="justify-start gap-2"
          onClick={() => onPick(p)}
        >
          <span>{[p.title, p.company].filter(Boolean).join(" · ")}</span>
          {p.application ? <Badge tone="ok">{t("mailReview.applied")}</Badge> : null}
        </Button>
      ))}
    </div>
  );
}

function Item({ m, quarantine }: { m: MailReviewItem; quarantine?: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: key });
  const ignore = useMutation({ mutationFn: () => api.ignoreMail(m.id), onSuccess: done });
  const apply = useMutation({
    mutationFn: (body: { postingId: string } | { confirm: true }) => api.applyMail(m.id, body),
    onSuccess: done,
  });
  const process = useMutation({
    mutationFn: () => api.processQuarantinedMail(m.id),
    onSuccess: done,
  });
  const trust = useMutation({
    // confiar reavalia o risco dos e-mails do remetente (SPF/DKIM falhando continuam em quarentena)
    mutationFn: async () => {
      const value = m.fromAddr ?? "";
      await api.putMailSender({ value, override: "trusted" });
      return api.reprocessMailSender(value);
    },
    onSuccess: done,
  });
  const [picking, setPicking] = useState(false);
  const busy = ignore.isPending || apply.isPending || process.isPending || trust.isPending;
  return (
    <Card role="article" aria-label={m.subject ?? m.gmailId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{m.subject ?? t("mailReview.noSubject")}</p>
          <p className="text-xs text-muted-fg">
            {m.from} · {when(m.receivedAt)}
          </p>
        </div>
        {m.class ? <Badge>{t(`mailReview.class.${m.class}` as TKey)}</Badge> : null}
      </div>
      {m.summary ? <p className="text-sm">{m.summary}</p> : null}
      {m.reason ? (
        <p className="text-xs text-muted-fg">{t("mailReview.reason", { reason: m.reason })}</p>
      ) : null}
      {quarantine && m.riskReasons.length ? (
        <ul aria-label={t("mailReview.riskReasons")} className="list-disc pl-5 text-xs text-danger">
          {m.riskReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <a
          href={m.mailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-center text-xs underline"
        >
          {t("mailReview.openGmail")}
        </a>
        {!quarantine && m.suggestedPosting ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => apply.mutate({ postingId: m.suggestedPosting?.id as string })}
          >
            {t("mailReview.applySuggested", {
              posting: [m.suggestedPosting.title, m.suggestedPosting.company]
                .filter(Boolean)
                .join(" · "),
            })}
          </Button>
        ) : null}
        {!quarantine && m.needsConfirm && !m.suggestedPosting ? (
          <Button size="sm" disabled={busy} onClick={() => apply.mutate({ confirm: true })}>
            {t("mailReview.applyAnyway")}
          </Button>
        ) : null}
        {!quarantine &&
        [
          "application_received",
          "rejection",
          "update",
          "interview_invite",
          "recruiter_contact",
        ].includes(m.class ?? "") ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setPicking((x) => !x)}
          >
            {t("mailReview.pickPosting")}
          </Button>
        ) : null}
        {quarantine && m.fromAddr ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => trust.mutate()}>
            {t("mailReview.trustAndProcess")}
          </Button>
        ) : null}
        {quarantine ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => process.mutate()}>
            {t("mailReview.processAnyway")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => ignore.mutate()}>
          {t("mailReview.ignore")}
        </Button>
        <RereadMailButton mailId={m.id} />
      </div>
      {picking ? (
        <PickPosting
          initial={m.company ?? m.title ?? ""}
          onPick={(p) => apply.mutate({ postingId: p.id })}
        />
      ) : null}
    </Card>
  );
}

/**
 * E-mails para revisar (F14-11, F14-14): os que o narnia não ligou a uma vaga com segurança e os da quarentena, com
 * o motivo. Escolher a vaga, ignorar, confiar no remetente ou processar mesmo assim.
 */
export function MailReviewPage() {
  const api = useApi();
  const q = useQuery({ queryKey: key, queryFn: () => api.getMailReview() });
  const review = q.data?.review ?? [];
  const quarantine = q.data?.quarantine ?? [];
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("mailReview.title")}</h1>
        <p className="text-sm text-muted-fg">{t("mailReview.hint")}</p>
      </div>
      <section aria-label={t("mailReview.review")} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("mailReview.review")}</h2>
        {review.length ? (
          review.map((m) => <Item key={m.id} m={m} />)
        ) : (
          <p className="text-sm text-muted-fg">{t("mailReview.empty")}</p>
        )}
      </section>
      <section aria-label={t("mailReview.quarantine")} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("mailReview.quarantine")}</h2>
        <p className="text-xs text-muted-fg">{t("mailReview.quarantineHint")}</p>
        {quarantine.length ? (
          quarantine.map((m) => <Item key={m.id} m={m} quarantine />)
        ) : (
          <p className="text-sm text-muted-fg">{t("mailReview.empty")}</p>
        )}
      </section>
    </div>
  );
}
