import type { Posting, PostingListItem } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { useApi, useTimezone } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Field } from "../../components/ui/field";
import { Input, Select, Textarea } from "../../components/ui/input";
import { TabPanel, Tabs } from "../../components/ui/tabs";
import { postingKeys, useFeed, usePostings } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { AnalyzePostingButton } from "./PostingAnalysis";
import { ArchivePostingButton } from "./PostingArchive";

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

const external = { target: "_blank", rel: "noopener noreferrer" } as const;
/** Quadro de vagas da Coders: o alerta dela não traz link por vaga (2026-11-12). */
export const CODERS_BOARD = "https://app.coders.com.br/vagas";

export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Local, modo e contrato numa linha só ("São Paulo - SP · Híbrido · CLT"). */
function placeLine(p: PostingListItem): string {
  const place = [p.city, p.state].filter(Boolean).join(" - ") || p.country || null;
  return [
    place,
    p.workMode ? t(`postings.workMode.${p.workMode}` as TKey) : null,
    p.contractType ? p.contractType.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Começo da descrição, sem quebras: o card mostra três linhas (a vaga inteira fica na página dela). */
function snippet(text: string | null): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

/**
 * Card do feed de vagas (pedido do dono 2026-11-12): uma coluna, com local, modo, começo da descrição, a data do e-mail
 * e as ações direto no card (analisar, vaga oficial, e-mail, arquivar).
 */
/**
 * Uma versão de um grupo de vagas iguais: local, plataforma e data do e-mail, para escolher em qual se candidatar;
 * "Separar" tira do grupo a que a pessoa confirmou ser outra vaga.
 */
function GroupMember({ v }: { v: PostingListItem }) {
  const tz = useTimezone();
  const api = useApi();
  const qc = useQueryClient();
  const split = useMutation({
    mutationFn: () => api.setPostingGroupSplit(v.id, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: postingKeys.all }),
  });
  const receivedAt = v.source === "email" ? (v.sourceRef?.receivedAt ?? null) : null;
  const info = [
    placeLine(v) || null,
    v.sourceRef?.platform ?? null,
    receivedAt ? t("postings.group.received", { date: formatDate(receivedAt, tz) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li aria-label={info || v.id} className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <span>{info || "—"}</span>
        {v.application ? <Badge tone="ok">{t("postings.group.applied")}</Badge> : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <NavLink to={`/vagas/${v.id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
          {t("postings.group.open")}
        </NavLink>
        {isHttpUrl(v.postingUrl) ? (
          <a
            href={v.postingUrl}
            {...external}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            {t("postings.openOriginal")}
          </a>
        ) : null}
        <Button size="sm" variant="ghost" disabled={split.isPending} onClick={() => split.mutate()}>
          {t("postings.group.split")}
        </Button>
      </span>
    </li>
  );
}

function PostingCard({ p, variants = [] }: { p: PostingListItem; variants?: PostingListItem[] }) {
  const tz = useTimezone();
  // F07 (pedido do dono 2026-10-27): a vaga já aplicada fica destacada, com a coluna da candidatura
  const applied = p.application;
  const receivedAt = p.source === "email" ? (p.sourceRef?.receivedAt ?? null) : null;
  const mailUrl = p.source === "email" ? (p.sourceRef?.mailUrl ?? null) : null;
  const place = placeLine(p);
  const text = snippet(p.jdText);
  return (
    <li aria-label={postingWho(p)}>
      <Card
        data-applied={applied ? "" : undefined}
        className={`flex flex-col gap-2 ${applied ? "border-ok bg-ok/5 ring-1 ring-ok/40" : ""}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <NavLink to={`/vagas/${p.id}`} className="text-base font-medium hover:underline">
              {p.company ?? t("postings.noCompany")}
            </NavLink>
            {p.client ? <span className="text-sm text-muted-fg">{p.client}</span> : null}
            <span className="text-sm">
              {p.title ?? "—"}
              {p.seniority ? ` · ${t(`postings.seniority.${p.seniority}` as TKey)}` : ""}
              {p.role ? ` · ${t(`postings.role.${p.role}` as TKey)}` : ""}
            </span>
          </div>
          <span className="flex shrink-0 flex-wrap gap-1">
            {p.matchScore !== null ? (
              <Badge
                tone={p.matchScore >= 70 && !p.matchScoreProvisional ? "ok" : "neutral"}
                title={p.matchScoreProvisional ? t("postings.feed.provisionalHint") : undefined}
              >
                {t(
                  p.matchScoreProvisional
                    ? "postings.feed.matchProvisional"
                    : "postings.feed.match",
                  { n: p.matchScore },
                )}
              </Badge>
            ) : null}
            {p.duplicate && p.duplicate.decision === null ? (
              <Badge tone="warn">{t("postings.duplicate.badge")}</Badge>
            ) : null}
            <Badge tone={statusTone[p.status]}>{t(`postings.status.${p.status}` as TKey)}</Badge>
          </span>
        </div>
        <span className="flex flex-wrap gap-1">
          {applied ? (
            <Badge tone="ok">
              {applied.archived
                ? t("postings.appliedArchived")
                : t("postings.applied", {
                    column: t(`jobApplications.column.${applied.column}` as TKey),
                  })}
            </Badge>
          ) : null}
          {p.archiveReason ? (
            <Badge tone="neutral">
              {t("postings.archivedBadge", {
                reason: t(`postings.archiveReason.${p.archiveReason}` as TKey),
              })}
            </Badge>
          ) : null}
          {p.source === "email" ? (
            <>
              {p.feedState === "new" ? <Badge tone="info">{t("postings.feed.new")}</Badge> : null}
              <Badge tone="neutral">
                {p.sourceRef?.platform
                  ? t("postings.feed.fromMailPlatform", { platform: p.sourceRef.platform })
                  : t("postings.feed.fromMail")}
              </Badge>
              {p.linkStatus === "failed" ? (
                <Badge tone="warn">{t("postings.feed.linkFailed")}</Badge>
              ) : null}
            </>
          ) : null}
        </span>
        {place ? <p className="text-sm text-muted-fg">{place}</p> : null}
        {text ? <p className="line-clamp-3 text-sm text-muted-fg">{text}</p> : null}
        <p className="text-xs text-muted-fg">
          {receivedAt
            ? t("postings.card.receivedAndSaved", {
                received: formatDate(receivedAt, tz),
                saved: formatDate(p.createdAt, tz),
              })
            : t("postings.createdAt", { date: formatDate(p.createdAt, tz) })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {p.analyzedAt ? (
            <NavLink
              to={`/vagas/${p.id}`}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              {t("postings.card.seeAnalysis")}
            </NavLink>
          ) : (
            <AnalyzePostingButton postingId={p.id} />
          )}
          {isHttpUrl(p.postingUrl) ? (
            <a
              href={p.postingUrl}
              {...external}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              {t("postings.openOriginal")}
            </a>
          ) : p.source === "email" && p.sourceRef?.platform === "coders" ? (
            <a
              href={CODERS_BOARD}
              {...external}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              {t("postings.openCodersBoard")}
            </a>
          ) : null}
          {isHttpUrl(mailUrl) ? (
            <a
              href={mailUrl}
              {...external}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              {t("postings.openMail")}
            </a>
          ) : null}
          {p.archivedAt ? null : <ArchivePostingButton postingId={p.id} />}
        </div>
        {variants.length ? (
          <details className="rounded-md border border-border p-2 text-sm">
            <summary className="cursor-pointer">
              {t("postings.group.summary", { n: variants.length + 1 })}
            </summary>
            <ul aria-label={t("postings.group.list")} className="mt-2 flex flex-col gap-1">
              {[p, ...variants].map((v) => (
                <GroupMember key={v.id} v={v} />
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </li>
  );
}

/** A lista de cards: vagas iguais (mesmo `groupId`) num card só, na posição da primeira. */
function PostingList({ label, postings }: { label: string; postings: PostingListItem[] }) {
  const byGroup = new Map<string, PostingListItem[]>();
  for (const p of postings)
    if (p.groupId) byGroup.set(p.groupId, [...(byGroup.get(p.groupId) ?? []), p]);
  const shown = new Set<string>();
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {postings.map((p) => {
        const members = p.groupId ? (byGroup.get(p.groupId) ?? [p]) : [p];
        if (p.groupId) {
          if (shown.has(p.groupId)) return null;
          shown.add(p.groupId);
        }
        return (
          <PostingCard key={p.id} p={members[0] as PostingListItem} variants={members.slice(1)} />
        );
      })}
    </ul>
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
/** Filtros do feed (F14/M7, plano §4): plataforma, período, só as novas, só as de link que não abriu. */
const FEED_PERIODS = ["all", "7", "30"] as const;

function FeedList() {
  const { postings: all, isLoading } = useFeed();
  const [platform, setPlatform] = useState("");
  const [period, setPeriod] = useState<(typeof FEED_PERIODS)[number]>("all");
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const platforms = [
    ...new Set(all.map((p) => p.sourceRef?.platform).filter((x): x is string => !!x)),
  ].sort();
  const since = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
  const postings = all.filter(
    (p) =>
      (!platform || p.sourceRef?.platform === platform) &&
      Date.parse(p.sourceRef?.receivedAt ?? p.createdAt) >= since &&
      (!onlyNew || p.feedState === "new") &&
      (!onlyFailed || p.linkStatus === "failed"),
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-fg">{t("postings.feed.hint")}</p>
      {all.length ? (
        <fieldset
          aria-label={t("postings.feed.filters")}
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <Select
            aria-label={t("postings.feed.platform")}
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-auto"
          >
            <option value="">{t("postings.feed.allPlatforms")}</option>
            {platforms.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("postings.feed.period")}
            value={period}
            onChange={(e) => setPeriod(e.target.value as (typeof FEED_PERIODS)[number])}
            className="w-auto"
          >
            {FEED_PERIODS.map((x) => (
              <option key={x} value={x}>
                {t(`postings.feed.periods.${x}` as TKey)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={onlyNew}
              onChange={(e) => setOnlyNew(e.target.checked)}
            />
            {t("postings.feed.onlyNew")}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={onlyFailed}
              onChange={(e) => setOnlyFailed(e.target.checked)}
            />
            {t("postings.feed.onlyFailed")}
          </label>
        </fieldset>
      ) : null}
      {!isLoading && all.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("postings.feed.empty")}</p>
      ) : !isLoading && postings.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("postings.feed.noMatch")}</p>
      ) : (
        <PostingList label={t("postings.tabs.feed")} postings={postings} />
      )}
    </div>
  );
}

export function PostingsPage() {
  const [tab, setTab] = useState("all");
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      items={[
        { value: "all", label: t("postings.tabs.all") },
        { value: "feed", label: t("postings.tabs.feed") },
      ]}
    >
      <TabPanel value="all">
        <AllPostings />
      </TabPanel>
      <TabPanel value="feed">
        <FeedList />
      </TabPanel>
    </Tabs>
  );
}

function AllPostings() {
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
        <PostingList label={t("postings.title")} postings={postings} />
      )}
      <NewPosting />
    </div>
  );
}
