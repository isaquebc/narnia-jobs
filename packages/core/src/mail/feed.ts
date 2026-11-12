import { formatInUserTz, localToUtc } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { ScheduledContext } from "../scheduler";

/**
 * Feed de vagas vindas de e-mail (F14-6, F14-7, F14-9): configurações, marcação da pré-análise automática e o
 * arquivamento de quem ficou 30 dias sem interação (fora do fit: `archive_auto`, nunca `archive_reason`).
 */
export const FEED_CUT_KEY = "mail.preanalysisCut";
export const FEED_CAP_KEY = "mail.preanalysisDailyCap";
export const FEED_CUT_DEFAULT = 70;
export const FEED_CAP_DEFAULT = 10;
export const FEED_STALE_DAYS = 30;

export interface FeedSettings {
  preanalysisCut: number;
  preanalysisDailyCap: number;
  linksPerRun: number;
}

export function feedSettings(repos: Repos): FeedSettings {
  return {
    preanalysisCut: repos.settings.get<number>(FEED_CUT_KEY) ?? FEED_CUT_DEFAULT,
    preanalysisDailyCap: repos.settings.get<number>(FEED_CAP_KEY) ?? FEED_CAP_DEFAULT,
    linksPerRun: repos.settings.get<number>("mail.linksPerRun") ?? 100,
  };
}

export function saveFeedSettings(
  repos: Repos,
  patch: { [K in keyof FeedSettings]?: FeedSettings[K] | undefined },
) {
  if (patch.preanalysisCut !== undefined) repos.settings.set(FEED_CUT_KEY, patch.preanalysisCut);
  if (patch.preanalysisDailyCap !== undefined)
    repos.settings.set(FEED_CAP_KEY, patch.preanalysisDailyCap);
  if (patch.linksPerRun !== undefined) repos.settings.set("mail.linksPerRun", patch.linksPerRun);
  return feedSettings(repos);
}

/** Início do dia de hoje no fuso da pessoa (revisão do M4: o teto não vira às 21h de Brasília). */
function startOfDay(repos: Repos, now: Date): string {
  const tz = repos.users.get()?.timezone || "America/Sao_Paulo";
  try {
    return localToUtc(`${formatInUserTz(now.toISOString(), tz, "YYYY-MM-DD")}T00:00`, tz);
  } catch {
    return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  }
}

/**
 * Marca as vagas do feed acima do corte para a pré-análise, sem passar do teto do dia. Só vagas de remetente
 * confiável (revisão do M4): a análise é um agente com tools lendo texto de terceiros, então o e-mail de qualquer um
 * não pode abri-la sozinho; as outras a pessoa analisa com um clique.
 */
export async function markAutoAnalyses(
  ctx: Pick<ScheduledContext, "repos" | "now" | "log" | "item" | "count" | "publish">,
) {
  const { repos } = ctx;
  const s = feedSettings(repos);
  const today = repos.postings.autoAnalysesSince(startOfDay(repos, ctx.now));
  const room = Math.max(0, s.preanalysisDailyCap - today);
  const picked = repos.postings
    .feed({ limit: 5000 })
    .filter(
      (p) =>
        !p.autoAnalysisAt &&
        p.sourceRef?.trusted === true &&
        p.status === "ready" &&
        p.matchScore !== null &&
        !p.matchScoreProvisional && // F14-16: o provisório (só pelo cargo) nunca abre o agente
        p.matchScore >= s.preanalysisCut &&
        !repos.jobAnalyses.list(p.id).length,
    )
    .slice(0, room);
  for (const p of picked) {
    repos.postings.setAutoAnalysisAt(p.id, ctx.now.toISOString());
    ctx.item({
      kind: "posting",
      refId: p.id,
      label: [p.title, p.company].filter(Boolean).join(" · "),
      action: `pré-análise pedida (match ${p.matchScore})`,
      href: `/vagas/${p.id}`,
    });
    await ctx.publish({ type: "posting.updated", postingId: p.id });
  }
  ctx.count("requested", picked.length);
  ctx.log(
    "info",
    `${picked.length} pré-análise(s) pedida(s); ${today + picked.length} de ${s.preanalysisDailyCap} hoje (corte ${s.preanalysisCut})`,
  );
}

/** Arquiva as vagas do feed sem interação há 30 dias e sem candidatura (F14-9), numa só instrução. */
export async function archiveStaleFeed(
  ctx: Pick<ScheduledContext, "repos" | "now" | "log" | "item" | "count" | "publish">,
) {
  const { repos } = ctx;
  const before = new Date(ctx.now.getTime() - FEED_STALE_DAYS * 86_400_000).toISOString();
  const ids = repos.postings.archiveStale(before, ctx.now.toISOString());
  for (const id of ids) {
    const p = repos.postings.get(id);
    ctx.item({
      kind: "posting",
      refId: id,
      label: [p?.title, p?.company].filter(Boolean).join(" · ") || id,
      action: "arquivada sem interação",
      href: `/vagas/${id}`,
    });
    await ctx.publish({ type: "posting.updated", postingId: id });
  }
  ctx.count("archived", ids.length);
  ctx.log("info", `${ids.length} vaga(s) do feed arquivada(s) por 30 dias sem interação`);
}
