import type { JobApplication, MailClassifyOutput, Posting } from "@narnia-jobs/shared";
import { formatInUserTz } from "@narnia-jobs/shared";
import type { MailMessageRecord, MoveOrigin, Repos } from "../db";
import { withTransaction } from "../db/open";
import { DEFAULT_STAGES } from "../job-applications";
import { addJobApplicationEntry, rejectJobApplication } from "../job-applications/entries";
import { canonicalUrl } from "../postings/canonical";
import { sameTitle, TITLE_NEAR, titleSimilarity } from "../postings/identity";
import type { ScheduledContext } from "../scheduler";
import { intakePostingFromMail } from "./postings";

/**
 * Candidatura recebida e negativa vindas de e-mail (F14/M5, plano §2.3): o e-mail é ligado à vaga (link → empresa e
 * cargo → candidatura ativa da empresa), a candidatura nasce ou é encerrada com a data e a hora do e-mail, e o e-mail
 * fica como nota datada com o link para o Gmail. Na dúvida (mais de uma vaga possível, ou sem empresa e cargo), o
 * e-mail vai para a caixa de revisão em vez de arriscar a candidatura errada (F14-11).
 */
export const MAIL_APPLICATION_CLASSES = ["application_received", "rejection"] as const;

type Resolution =
  | { kind: "found"; posting: Posting; via: string }
  | { kind: "none" }
  | { kind: "ambiguous"; reason: string; suggestedPostingId?: string };

/**
 * Acha a vaga do e-mail (correção 2026-11-11: comparar a identidade com hash duplicava as candidaturas, porque a vaga
 * da extensão guarda também a função e o cargo vinha com código ou escrito diferente):
 * 1. link canônico;
 * 2. mesma empresa (sem sufixos) e cargo igual por semelhança: a vaga com candidatura vence a do feed; mais de uma
 *    com candidatura, revisão;
 * 3. sem cargo no e-mail: a única candidatura ativa da empresa;
 * 4. empresa com candidatura e cargo só parecido: revisão com a sugestão (nunca outra candidatura por engano).
 */
export function resolveMailPosting(repos: Repos, cls: MailClassifyOutput): Resolution {
  const canonical = cls.postingUrl ? canonicalUrl(cls.postingUrl) : null;
  if (canonical) {
    const byUrl = repos.postings.findByCanonicalUrl(canonical)[0];
    if (byUrl) return { kind: "found", posting: byUrl, via: "link" };
  }
  if (!cls.company) return { kind: "none" };
  const sameCo = repos.postings.byCompany(cls.company);
  const withApp = (p: Posting) => !!repos.jobApplications.latestForPosting(p.id);
  if (cls.title) {
    const scored = sameCo.map((p) => ({
      p,
      sim: titleSimilarity(p.title, cls.title),
      same: sameTitle(p.title, cls.title),
    }));
    const same = scored.filter((x) => x.same);
    if (same.length) {
      const applied = same.filter((x) => withApp(x.p));
      if (applied.length === 1)
        return { kind: "found", posting: (applied[0] as { p: Posting }).p, via: "empresa e cargo" };
      if (applied.length > 1)
        return {
          kind: "ambiguous",
          reason: `${applied.length} candidaturas para ${cls.title} na ${cls.company}`,
        };
      // sem candidatura: as do feed do e-mail são cópias do alerta; a salva por você vence
      const saved = same.filter((x) => x.p.source !== "email");
      if (saved.length === 1)
        return { kind: "found", posting: (saved[0] as { p: Posting }).p, via: "empresa e cargo" };
      if (saved.length > 1)
        return { kind: "ambiguous", reason: `${saved.length} vagas com a mesma empresa e cargo` };
      const newest = [...same].sort((a, b) => b.p.createdAt.localeCompare(a.p.createdAt))[0];
      return {
        kind: "found",
        posting: (newest as { p: Posting }).p,
        via: "empresa e cargo (feed)",
      };
    }
    const near = scored
      .filter((x) => !x.same && x.sim >= TITLE_NEAR && withApp(x.p))
      .sort((a, b) => b.sim - a.sim);
    if (near.length)
      return {
        kind: "ambiguous",
        reason: `cargo parecido com uma candidatura que já existe na ${cls.company} (${near[0]?.p.title}): confirme se é a mesma`,
        suggestedPostingId: (near[0] as { p: Posting }).p.id,
      };
    return { kind: "none" };
  }
  const active = sameCo.filter((p) => {
    const a = repos.jobApplications.latestForPosting(p.id);
    return !!a && !a.archivedAt && a.column !== "closed";
  });
  if (active.length === 1)
    return { kind: "found", posting: active[0] as Posting, via: "candidatura ativa da empresa" };
  if (active.length > 1)
    return { kind: "ambiguous", reason: `${active.length} candidaturas ativas na ${cls.company}` };
  return { kind: "none" };
}

/**
 * Perfil e CV da candidatura vinda de e-mail (F14-5, F14-15): CV gerado para a vaga (o perfil dele, CV presumido) →
 * perfil recomendado pela análise da vaga → o único perfil → a escolher (o modelo escolhe pela análise da vaga, que é
 * pedida se o remetente for confiável).
 */
function profileAndCv(repos: Repos, posting: Posting) {
  const ready = (s: string) => s === "ready" || s === "ready_with_issues";
  for (const d of repos.documents.list({ postingId: posting.id, kind: "cv" })) {
    // a última versão pronta (a atual pode estar sendo gerada ou ter falhado)
    const v = repos.documents.listVersions(d.id).find((x) => ready(x.status));
    if (v)
      return { profileId: d.profileId, cvVersionId: v.id, cvPresumed: true, profilePending: false };
  }
  // carta gerada para a vaga: o perfil dela (sem CV presumido)
  const letter = repos.documents.list({ postingId: posting.id, kind: "cover_letter" })[0];
  if (letter)
    return {
      profileId: letter.profileId,
      cvVersionId: null,
      cvPresumed: false,
      profilePending: false,
    };
  const recommended = repos.jobAnalyses.latest(posting.id)?.recommendedProfileId ?? null;
  if (recommended)
    return { profileId: recommended, cvVersionId: null, cvPresumed: false, profilePending: false };
  const profiles = repos.profiles.list().filter((p) => !p.archivedAt);
  if (profiles.length === 1)
    return {
      profileId: profiles[0]?.id ?? null,
      cvVersionId: null,
      cvPresumed: false,
      profilePending: false,
    };
  return { profileId: null, cvVersionId: null, cvPresumed: false, profilePending: true };
}

const dayOf = (repos: Repos, iso: string) =>
  formatInUserTz(iso, repos.users.get()?.timezone || "America/Sao_Paulo", "YYYY-MM-DD");

const mailNote = (repos: Repos, msg: MailMessageRecord, cls: MailClassifyOutput, title: string) =>
  [
    `${title} (e-mail de ${msg.fromName ?? msg.fromAddr ?? "remetente desconhecido"}, ${formatInUserTz(msg.receivedAt, repos.users.get()?.timezone || "America/Sao_Paulo", "DD/MM/YYYY HH:mm")})`,
    msg.subject ? `Assunto: ${msg.subject}` : null,
    cls.summary,
    `Abrir no Gmail: https://mail.google.com/mail/u/0/#all/${msg.gmailId}`,
  ]
    .filter(Boolean)
    .join("\n");

/** Candidatura nova a partir do e-mail, com o instante dele na passagem para Aplicado. */
function createFromMail(repos: Repos, posting: Posting, msg: MailMessageRecord): JobApplication {
  const pc = profileAndCv(repos, posting);
  const app = repos.jobApplications.create({
    postingId: posting.id,
    profileId: pc.profileId,
    cvVersionId: pc.cvVersionId,
    coverLetterVersionId: null,
    appliedOn: dayOf(repos, msg.receivedAt),
    stages: posting.hiringSteps.length ? posting.hiringSteps : [...DEFAULT_STAGES],
    source: "email",
    cvPresumed: pc.cvPresumed,
    profilePending: pc.profilePending,
    sourceRef: {
      gmailId: msg.gmailId,
      mailUrl: `https://mail.google.com/mail/u/0/#all/${msg.gmailId}`,
    },
    appliedAt: msg.receivedAt,
    mailMessageId: msg.id,
  });
  // perfil a escolher: o modelo escolhe pela análise da vaga (só com remetente confiável, como a pré-análise)
  if (pc.profilePending && msg.riskLevel === "trusted" && !posting.autoAnalysisAt)
    repos.postings.setAutoAnalysisAt(posting.id, new Date().toISOString());
  repos.postings.touchInteraction(posting.id);
  return app;
}

export interface MailApplicationsResult {
  created: number;
  closed: number;
  noted: number;
  review: number;
}

/** Instante em que a candidatura foi encerrada pela última vez (passagem para Encerrado). */
export function closedAt(repos: Repos, applicationId: string): string | null {
  const r = repos.db
    .prepare(
      "select max(at) as at from job_application_move where job_application_id = ? and to_column = 'closed'",
    )
    .get(applicationId) as { at: string | null } | undefined;
  return r?.at ?? null;
}

type Plan =
  | { kind: "review"; reason: string; suggestedPostingId?: string; needsConfirm?: boolean }
  | { kind: "note"; app: JobApplication; posting: Posting; title: string; action: string }
  | { kind: "create"; posting: Posting | null }
  | { kind: "reject"; app: JobApplication | null; posting: Posting };

/** Campos de controle da revisão: saem do resultado quando o e-mail é aplicado (revisão do M5, #12). */
const clean = (cls: MailClassifyOutput) => {
  const {
    review: _r,
    forcedPostingId: _f,
    confirmed: _c,
    suggestedPostingId: _s,
    needsConfirm: _n,
    ...rest
  } = cls as MailClassifyOutput & Record<string, unknown>;
  return rest;
};

/**
 * Decide o que fazer com o e-mail, sem gravar nada. A pessoa decidiu na revisão (vaga escolhida ou "aplicar mesmo
 * assim") → vale a decisão. Remetente sem confiança (risco `neutral`, §2.7) só grava nota numa candidatura que já
 * existe; criar ou encerrar candidatura pede a revisão.
 */
function planMail(repos: Repos, msg: MailMessageRecord, cls: MailClassifyOutput): Plan {
  const ctl = cls as MailClassifyOutput & { forcedPostingId?: string; confirmed?: boolean };
  const forcedPosting = ctl.forcedPostingId ? repos.postings.get(ctl.forcedPostingId) : null;
  const decided = !!forcedPosting || ctl.confirmed === true;
  const trusted = decided || msg.riskLevel === "trusted";
  const r: Resolution = forcedPosting
    ? { kind: "found", posting: forcedPosting, via: "escolha na revisão" }
    : resolveMailPosting(repos, cls);
  if (r.kind === "ambiguous")
    return {
      kind: "review",
      reason: r.reason,
      ...(r.suggestedPostingId ? { suggestedPostingId: r.suggestedPostingId } : {}),
    };
  const posting = r.kind === "found" ? r.posting : null;
  // a última candidatura da vaga, inclusive arquivada ou encerrada (revisão do M5, #3: nunca duplicar)
  const latest = posting ? repos.jobApplications.latestForPosting(posting.id) : null;
  const untrusted = (what: string): Plan => ({
    kind: "review",
    reason: `remetente ainda sem confiança: confirme antes de ${what}`,
    needsConfirm: true,
    ...(posting ? { suggestedPostingId: posting.id } : {}),
  });

  if (cls.class === "application_received") {
    if (latest && latest.column !== "closed")
      return {
        kind: "note",
        app: latest,
        posting: posting as Posting,
        title: "Confirmação de candidatura",
        action: "confirmação registrada",
      };
    // encerrada depois deste e-mail (a confirmação chegou atrasada, ou foi revisada depois da negativa): só a nota
    if (latest && (closedAt(repos, latest.id) ?? "") > msg.receivedAt)
      return {
        kind: "note",
        app: latest,
        posting: posting as Posting,
        title: "Confirmação de candidatura",
        action: "confirmação registrada (candidatura já encerrada)",
      };
    if (!posting && !(cls.company && cls.title))
      return { kind: "review", reason: "o e-mail não diz a empresa e o cargo" };
    if (!trusted) return untrusted("criar a candidatura");
    return { kind: "create", posting };
  }

  // negativa
  if (latest?.column === "closed")
    return {
      kind: "note",
      app: latest,
      posting: posting as Posting,
      title: "Negativa",
      action: "negativa registrada (já estava encerrada)",
    };
  if (!posting)
    return {
      kind: "review",
      reason:
        cls.company && cls.title
          ? `nenhuma vaga salva de ${cls.title} na ${cls.company}`
          : "o e-mail não diz a empresa e o cargo",
    };
  if (!latest && !decided)
    return {
      kind: "review",
      reason: "nenhuma candidatura nesta vaga",
      suggestedPostingId: posting.id,
    };
  if (!trusted) return untrusted("encerrar a candidatura");
  return { kind: "reject", app: latest, posting };
}

/** E-mail mais antigo ainda sem classe (avaliação ou modelo pendentes): nada mais novo que ele é aplicado (§2.2). */
/** E-mail pendente mais antigo destas classes (a ordem entre o M5 e o M6, revisão do M6, #13). */
export function oldestPendingOf(repos: Repos, classes: string[]): string | null {
  return repos.mail.byClasses(classes, "pending", 1)[0]?.receivedAt ?? null;
}

export function oldestUnclassified(repos: Repos): string | null {
  const a = repos.mail.unassessed(1)[0]?.receivedAt ?? null;
  const b = repos.mail.toDigest(1)[0]?.receivedAt ?? null;
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export async function applyMailApplications(input: {
  repos: Repos;
  dataDir: string;
  ctx: Pick<ScheduledContext, "log" | "item" | "count" | "publish">;
  limit?: number;
}): Promise<MailApplicationsResult> {
  const { repos, ctx } = input;
  const out: MailApplicationsResult = { created: 0, closed: 0, noted: 0, review: 0 };
  const unclassified = oldestUnclassified(repos);
  // atualização ou convite mais antigo ainda pendente (M6) também segura os mais novos daqui
  const m6 = oldestPendingOf(repos, ["update", "interview_invite", "recruiter_contact"]);
  const barrier = !unclassified ? m6 : !m6 ? unclassified : unclassified < m6 ? unclassified : m6;
  let held = 0;
  // do mais antigo para o mais novo, as duas classes juntas: a negativa nunca antes da confirmação (§2.2)
  for (const msg of repos.mail.byClasses(
    [...MAIL_APPLICATION_CLASSES],
    "pending",
    input.limit ?? 100,
  )) {
    // revisão do M5, #4: um e-mail mais antigo ainda sem classe pode ser a confirmação desta negativa
    if (barrier && msg.receivedAt > barrier) {
      held++;
      continue;
    }
    const at = new Date().toISOString();
    const cls = msg.result as unknown as MailClassifyOutput | null;
    if (!cls) continue;
    const label = msg.subject ?? "(sem assunto)";
    const toReview = (reason: string, extra: Record<string, unknown> = {}) => {
      repos.mail.setResult(
        msg.id,
        {
          status: "review",
          class: msg.class ?? cls.class,
          confidence: msg.confidence,
          result: { ...clean(cls), ...extra, review: reason },
        },
        at,
      );
      out.review++;
      ctx.item({
        kind: "mail",
        refId: msg.gmailId,
        label,
        action: "para revisão",
        result: "skipped",
        detail: reason,
      });
    };
    const events: Array<Parameters<typeof ctx.publish>[0]> = [];
    try {
      // revisão do M5, #2: tudo do e-mail numa transação; os avisos só depois do commit
      const done = withTransaction(repos.db, () => {
        const plan = planMail(repos, msg, cls);
        if (plan.kind === "review") {
          toReview(plan.reason, {
            ...(plan.suggestedPostingId ? { suggestedPostingId: plan.suggestedPostingId } : {}),
            ...(plan.needsConfirm ? { needsConfirm: true } : {}),
          });
          return null;
        }
        const origin: MoveOrigin = { at: msg.receivedAt, source: "email", mailMessageId: msg.id };
        const occurredOn = dayOf(repos, msg.receivedAt);
        let app: JobApplication;
        let posting: Posting;
        let action: string;
        let counter: "noted" | "created" | "closed";
        if (plan.kind === "note") {
          ({ app, posting, action } = plan);
          const entry = addJobApplicationEntry(repos, input.dataDir, app.id, {
            occurredOn,
            body: mailNote(repos, msg, cls, plan.title),
            files: [],
          });
          repos.mail.addUndo(msg.id, { entryIds: [entry.id] });
          counter = "noted";
        } else if (plan.kind === "create") {
          posting = plan.posting ?? newPostingFromMail(repos, msg, cls);
          app = createFromMail(repos, posting, msg);
          const note = addJobApplicationEntry(repos, input.dataDir, app.id, {
            occurredOn,
            body: mailNote(repos, msg, cls, "Confirmação de candidatura"),
            files: [],
          });
          // desfazer apaga a candidatura (e a nota com ela) e a vaga criada pelo e-mail
          repos.mail.addUndo(msg.id, {
            createdApplicationId: app.id,
            entryIds: [note.id],
            ...(plan.posting ? {} : { createdPostingId: posting.id }),
          });
          action = "candidatura criada";
          counter = "created";
        } else {
          posting = plan.posting;
          const existing = plan.app;
          app = existing ?? createFromMail(repos, posting, msg);
          repos.mail.addUndo(
            msg.id,
            existing
              ? {
                  closed: {
                    applicationId: app.id,
                    column: app.column,
                    closedReason: app.closedReason,
                    closedStage: app.closedStage,
                    closedEntryId: app.closedEntryId,
                  },
                }
              : { createdApplicationId: app.id },
          );
          const closedApp = rejectJobApplication(
            repos,
            input.dataDir,
            app.id,
            {
              occurredOn,
              message: mailNote(repos, msg, cls, "Negativa"),
              stageId: app.currentStageId,
            },
            new Date(),
            origin,
          );
          if (closedApp.closedEntryId)
            repos.mail.addUndo(msg.id, { entryIds: [closedApp.closedEntryId] });
          action = "candidatura encerrada (negativa)";
          counter = "closed";
          const { notification, created } = repos.notifications.upsert({
            kind: "mail.application_closed",
            subjectKind: "job_application",
            subjectId: app.id,
            title: `Negativa: ${[posting.title, posting.company].filter(Boolean).join(" · ")}`,
            body: cls.summary,
            actionUrl: `/candidaturas/${app.id}`,
            severity: "info",
          });
          events.push({
            type: created ? "notification.created" : "notification.updated",
            notification,
          });
        }
        repos.mail.setResult(
          msg.id,
          {
            status: "done",
            class: msg.class ?? cls.class,
            confidence: msg.confidence,
            result: { ...clean(cls), postingId: posting.id, applicationId: app.id },
          },
          at,
        );
        return { app, posting, action, counter };
      });
      if (!done) continue;
      out[done.counter]++;
      ctx.item({
        kind: "job_application",
        refId: done.app.id,
        label: [done.posting.title, done.posting.company].filter(Boolean).join(" · "),
        action: done.action,
        detail: label,
        href: `/candidaturas/${done.app.id}`,
      });
      events.push({ type: "job_application.updated", applicationId: done.app.id });
      events.push({ type: "posting.updated", postingId: done.posting.id });
      for (const e of events) await ctx.publish(e).catch(() => {});
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      toReview(error);
      ctx.log(
        "warn",
        `E-mail ${msg.gmailId} não foi aplicado à candidatura (${error}); vai para a revisão`,
      );
    }
  }
  if (held)
    ctx.log(
      "info",
      `${held} e-mail(s) de candidatura esperam a leitura de um e-mail mais antigo (ordem cronológica)`,
    );
  if (out.created) ctx.count("applications", out.created);
  if (out.closed) ctx.count("rejections", out.closed);
  if (out.review) ctx.count("review", out.review);
  return out;
}

/** Vaga nova para a confirmação de uma candidatura que o narnia não conhecia (não vai para o feed). */
function newPostingFromMail(
  repos: Repos,
  msg: MailMessageRecord,
  cls: MailClassifyOutput,
): Posting {
  const created = intakePostingFromMail(repos, {
    title: cls.title as string,
    company: cls.company,
    location: null,
    url: cls.postingUrl,
    gmailId: msg.gmailId,
    platform: null,
    trusted: msg.riskLevel === "trusted",
  }).posting;
  repos.postings.setFeedState(created.id, "seen");
  return created;
}

/** Notificação agrupada da caixa de revisão e da quarentena (abre a página "E-mails para revisar"). */
export async function syncMailReviewNotification(
  repos: Repos,
  publish: ScheduledContext["publish"],
) {
  const n = repos.mail.listByStatus(["review", "quarantine"], 1000).length;
  if (!n) {
    for (const notification of repos.notifications.resolveSubject("mail", "review", [
      "mail.review",
    ]))
      await publish({ type: "notification.updated", notification });
    return;
  }
  const { notification, created } = repos.notifications.upsert({
    kind: "mail.review",
    subjectKind: "mail",
    subjectId: "review",
    title: `${n} e-mail(s) para revisar`,
    body: "E-mails que o narnia não conseguiu ligar a uma vaga com segurança, ou que ficaram em quarentena.",
    actionUrl: "/emails",
    severity: "warning",
  });
  await publish({ type: created ? "notification.created" : "notification.updated", notification });
}
