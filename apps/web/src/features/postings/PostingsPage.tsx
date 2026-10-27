import type { Posting, PostingListItem } from "@narnia-jobs/shared";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Textarea } from "../../components/ui/input";
import { usePostings } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";

/** Quem contrata e o cliente, como no título da conversa da análise (F06 §1.1). */
export function postingWho(p: Pick<Posting, "company" | "client">): string {
  return [p.company, p.client].filter(Boolean).join(" / ") || t("postings.noCompany");
}

export const statusTone: Record<Posting["status"], "ok" | "warn" | "danger" | "neutral"> = {
  draft: "neutral",
  extracting: "warn",
  ready: "ok",
  error: "danger",
};

function PostingCard({ p }: { p: PostingListItem }) {
  const tz = useTimezone();
  // F07 (pedido do dono 2026-10-27): a vaga já aplicada fica destacada, com a coluna da candidatura
  const applied = p.application;
  return (
    <li aria-label={postingWho(p)}>
      <NavLink to={`/vagas/${p.id}`} className="block">
        <Card
          data-applied={applied ? "" : undefined}
          className={`flex h-full flex-col gap-1 hover:bg-muted ${applied ? "border-ok bg-ok/5 ring-1 ring-ok/40" : ""}`}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-medium">{p.company ?? t("postings.noCompany")}</h3>
            <span className="flex shrink-0 gap-1">
              {p.duplicate && p.duplicate.decision === null ? (
                <Badge tone="warn">{t("postings.duplicate.badge")}</Badge>
              ) : null}
              <Badge tone={statusTone[p.status]}>{t(`postings.status.${p.status}` as TKey)}</Badge>
            </span>
          </div>
          {applied ? (
            <Badge tone="ok" className="self-start">
              {applied.archived
                ? t("postings.appliedArchived")
                : t("postings.applied", {
                    column: t(`jobApplications.column.${applied.column}` as TKey),
                  })}
            </Badge>
          ) : null}
          {p.archiveReason ? (
            <Badge tone="neutral" className="self-start">
              {t("postings.archivedBadge", {
                reason: t(`postings.archiveReason.${p.archiveReason}` as TKey),
              })}
            </Badge>
          ) : null}
          {p.client ? <p className="text-sm text-muted-fg">{p.client}</p> : null}
          <p className="text-sm">
            {p.title ?? "—"}
            {p.seniority ? ` · ${t(`postings.seniority.${p.seniority}` as TKey)}` : ""}
          </p>
          {p.role ? (
            <p className="text-xs text-muted-fg">{t(`postings.role.${p.role}` as TKey)}</p>
          ) : null}
          <p className="mt-auto text-xs text-muted-fg">
            {t("postings.createdAt", { date: formatDate(p.createdAt, tz) })}
          </p>
        </Card>
      </NavLink>
    </li>
  );
}

function NewPosting() {
  const api = useApi();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.intakePosting(text.trim() ? { text: text.trim() } : { url: url.trim() });
      void navigate({ to: `/vagas/${r.posting.id}` as string });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle className="mb-2 text-base">{t("postings.newTitle")}</CardTitle>
      <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)}>
        <Field label={t("postings.newText")} htmlFor="posting-new-text">
          <Textarea
            id="posting-new-text"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("postings.newTextHint")}
          />
        </Field>
        <Field label={t("postings.newUrl")} htmlFor="posting-new-url">
          <Input
            id="posting-new-url"
            type="url"
            value={url}
            disabled={text.trim().length > 0}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div>
          <Button type="submit" disabled={busy || (!text.trim() && !url.trim())}>
            {busy ? t("postings.saving") : t("postings.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Texto digitado com espera: a busca só vai ao servidor quando a pessoa para de digitar. */
function useDebounced(value: string, ms = 250): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Vagas (F06 §1.3): todas as vagas analisadas em cards, da mais nova para a mais antiga, a busca por texto (empresa,
 * cliente, cargo, role ou contato; correção de 2026-10-15) e a entrada de uma nova. F07: as aplicadas em destaque e as
 * arquivadas à parte ("Ver arquivadas").
 */
export function PostingsPage() {
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const query = useDebounced(search.trim());
  const { postings, isLoading } = usePostings(query, archived);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t("postings.title")}</h1>
          <p className="text-sm text-muted-fg">{t("postings.hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            {t("postings.showArchived")}
          </label>
          <Input
            type="search"
            aria-label={t("postings.search")}
            placeholder={t("postings.searchHint")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72"
          />
        </div>
      </div>
      {!isLoading && postings.length === 0 ? (
        <p className="text-sm text-muted-fg">
          {query ? t("postings.searchEmpty", { q: query }) : t("postings.empty")}
        </p>
      ) : (
        <ul
          aria-label={t("postings.title")}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {postings.map((p) => (
            <PostingCard key={p.id} p={p} />
          ))}
        </ul>
      )}
      <NewPosting />
    </div>
  );
}
