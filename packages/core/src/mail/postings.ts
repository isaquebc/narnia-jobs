import type { Posting, PostingFields, PreAnalysis } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { canonicalUrl } from "../postings/canonical";
import type { FetchPostingOptions } from "../postings/fetch/fetch";
import { fetchPostingPage } from "../postings/fetch/fetch";
import { sameTitle } from "../postings/identity";
import { refreshPreAnalysis } from "../postings/ingest";
import { buildPreAnalysis } from "../postings/match";
import type { ScheduledContext } from "../scheduler";

/**
 * Vagas vindas de e-mail (F14/M4, plano §2.0.1): cada vaga de um alerta vira uma vaga com origem `email`, a flag do
 * link e o estado do feed; o link é aberto depois, em lote e devagar (F14-10); o score de match sem tokens ordena o
 * feed e decide a pré-análise automática (F14-6).
 */
export interface MailJobInput {
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  gmailId: string;
  platform: string | null;
  /** Remetente confiável (risco `trusted`): só assim a vaga entra na pré-análise automática. */
  trusted?: boolean;
}

/** Só http(s) e URL que o `new URL` aceita (revisão do M4: um link torto quebrava a leitura de todas as vagas). */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export const MAIL_LINKS_PER_RUN_KEY = "mail.linksPerRun";
export const MAIL_LINKS_PER_RUN_DEFAULT = 100;

/** "São Paulo, SP (Híbrido)", "Remoto", "Curitiba – PR" → cidade, UF e modo de trabalho. */
export function parseLocation(raw: string | null): Partial<PostingFields> {
  if (!raw) return {};
  const t = raw.trim();
  const out: Partial<PostingFields> = {};
  if (/remot|remote|home ?office/i.test(t)) out.workMode = "remote";
  else if (/h[íi]brid|hybrid/i.test(t)) out.workMode = "hybrid";
  else if (/presencial|on-?site/i.test(t)) out.workMode = "onsite";
  const place = t
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(remoto|remote|h[íi]brido|hybrid|presencial|on-?site)\b/gi, "");
  const m = place.match(/^\s*([^,–\-/]+?)\s*[,–\-/]\s*([A-Z]{2})\b/);
  if (m) {
    out.city = (m[1] as string).trim();
    out.state = m[2] as string;
    out.country = "BR";
  } else if (place.trim() && !/,/.test(place) && place.trim().length < 40) out.city = place.trim();
  return out;
}

/**
 * Cria a vaga de uma vaga do e-mail, ou acha a que já existe (mesmo link canônico, ou mesma empresa e cargo): nunca
 * duplica. Devolve a vaga e se foi criada.
 */
export function intakePostingFromMail(
  repos: Repos,
  job: MailJobInput,
): { posting: Posting; created: boolean } {
  const url = safeHttpUrl(job.url);
  const canonical = url ? canonicalUrl(url) : null;
  if (canonical) {
    const same = repos.postings.findByCanonicalUrl(canonical)[0];
    if (same) return { posting: same, created: false };
  }
  const fields: Partial<PostingFields> = {
    title: job.title.trim() || null,
    company: job.company?.trim() || null,
    ...parseLocation(job.location),
    ...(url ? { postingUrl: url } : {}),
  };
  if (fields.company && fields.title) {
    // mesma empresa e cargo é a mesma vaga, a não ser que as duas tenham links diferentes (ex.: SP e RJ); por
    // semelhança, não por hash (correção 2026-11-11: a vaga da extensão guarda a função e o hash nunca batia)
    const same = repos.postings
      .byCompany(fields.company)
      .find(
        (p) =>
          sameTitle(p.title, fields.title) &&
          (!canonical || !p.postingUrl || canonicalUrl(p.postingUrl) === canonical),
      );
    if (same) return { posting: same, created: false };
  }
  const posting = repos.postings.create(fields, { source: "email", status: "draft" });
  repos.postings.setOrigin(posting.id, {
    source: "email",
    sourceRef: {
      gmailId: job.gmailId,
      platform: job.platform,
      mailUrl: `https://mail.google.com/mail/u/0/#all/${job.gmailId}`,
      trusted: job.trusted === true,
    },
    linkStatus: url ? "none" : null,
    feedState: "new",
  });
  return { posting: repos.postings.get(posting.id) as Posting, created: true };
}

/** Score de match sem tokens (0–100): cobertura dos obrigatórios no melhor perfil, menos 10 por risco dele. */
export function matchScoreOf(pre: PreAnalysis | null): number | null {
  if (!pre || pre.coverage === null) return null;
  const base = pre.coverage * 100;
  const profiles = Object.values(pre.risksByProfile);
  const best = profiles.length ? Math.min(...profiles.map((r) => r.length)) : 0;
  return Math.max(0, Math.min(100, Math.round(base - 10 * best)));
}

/** Recalcula o score da vaga a partir da pré-análise guardada (depois do link e da extração). */
export function refreshMatchScore(repos: Repos, postingId: string): number | null {
  const p = repos.postings.get(postingId);
  if (!p) return null;
  const score = matchScoreOf((p.preAnalysis as PreAnalysis | null) ?? null);
  repos.postings.setMatchScore(postingId, score);
  return score;
}

export interface LinkOpenResult {
  opened: number;
  failed: number;
}

/**
 * Abre os links das vagas vindas de e-mail que ainda não foram tentados (F14-10: até N por execução, uma por vez, com
 * pausa por domínio). Abriu: o texto vira a descrição, a heurística e a pré-análise rodam na hora e a extração pelo
 * modelo vai para a fila; não abriu: `link_status = failed` (a flag pedida pelo dono), com o motivo no log.
 */
export async function openMailPostingLinks(input: {
  repos: Repos;
  ctx: Pick<ScheduledContext, "log" | "item" | "count">;
  fetchOptions?: FetchPostingOptions;
  enqueueExtract: (postingId: string) => Promise<void>;
  limit?: number;
  /** Pausa entre dois links do mesmo domínio (ms). */
  spacingMs?: number;
}): Promise<LinkOpenResult> {
  const { repos, ctx } = input;
  const limit =
    input.limit ?? repos.settings.get<number>(MAIL_LINKS_PER_RUN_KEY) ?? MAIL_LINKS_PER_RUN_DEFAULT;
  const todo = repos.postings.linkPending(limit);
  const lastByHost = new Map<string, number>();
  const out: LinkOpenResult = { opened: 0, failed: 0 };
  for (const p of todo) {
    const url = p.postingUrl as string;
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      // link inválido: cai no erro do fetch
    }
    const wait = (lastByHost.get(host) ?? 0) + (input.spacingMs ?? 1500) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastByHost.set(host, Date.now());
    const label = [p.title, p.company].filter(Boolean).join(" · ") || url;
    const page = await fetchPostingPage(url, input.fetchOptions);
    // revisão do M4: relê depois do fetch; a pessoa (ou a extensão) pode ter colado a descrição enquanto isso
    const fresh = repos.postings.get(p.id);
    if (!fresh || fresh.linkStatus !== "none") continue;
    if (fresh.jdText) {
      repos.postings.setLinkStatus(p.id, "ok");
      ctx.item({
        kind: "posting",
        refId: p.id,
        label,
        action: "já tinha descrição",
        result: "skipped",
        href: `/vagas/${p.id}`,
      });
      continue;
    }
    if (!page.ok) {
      repos.postings.setLinkStatus(p.id, "failed");
      out.failed++;
      ctx.item({
        kind: "posting",
        refId: p.id,
        label,
        action: "link não abriu",
        result: "skipped",
        detail: page.message,
        href: `/vagas/${p.id}`,
      });
      continue;
    }
    const analysis = buildPreAnalysis(repos, page.text, p);
    const fill: Partial<PostingFields> = { jdText: page.text };
    for (const [k, v] of Object.entries(analysis.fields))
      if (v !== null && v !== undefined && (p as Record<string, unknown>)[k] == null)
        (fill as Record<string, unknown>)[k] = v;
    repos.postings.update(p.id, fill, { source: "heuristic", sources: { jdText: "email" } });
    repos.postings.setPreAnalysis(
      p.id,
      refreshPreAnalysis(repos, repos.postings.get(p.id) as Posting, analysis.preAnalysis),
    );
    repos.postings.setLinkStatus(p.id, "ok");
    repos.postings.setStatus(p.id, "extracting");
    refreshMatchScore(repos, p.id);
    await input.enqueueExtract(p.id);
    out.opened++;
    ctx.item({
      kind: "posting",
      refId: p.id,
      label,
      action: "link aberto",
      href: `/vagas/${p.id}`,
    });
  }
  if (out.opened) ctx.count("links_opened", out.opened);
  if (out.failed) ctx.count("links_failed", out.failed);
  if (todo.length) ctx.log("info", `${out.opened} link(s) aberto(s), ${out.failed} não abriram`);
  return out;
}
