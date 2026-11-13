import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobApplication, JobApplicationStage, MailClassifyOutput } from "@narnia-jobs/shared";
import { formatInUserTz, localToUtc, parseIcs } from "@narnia-jobs/shared";
import type { MailMessageRecord, MailUndo, Repos, StageSuggestion } from "../db";
import { withTransaction } from "../db/open";
import { addJobApplicationEntry } from "../job-applications/entries";
import { normalizeIdentityPart } from "../postings/identity";
import type { ScheduledContext } from "../scheduler";
import {
  cleanProcess,
  createMailTodos,
  hasDefaultStages,
  senderMatchesPosting,
} from "../todos/from-mail";
import {
  closedAt,
  MAIL_APPLICATION_CLASSES,
  oldestPendingOf,
  oldestUnclassified,
  resolveMailPosting,
} from "./applications";
import { domainOfAddress } from "./domains";
import { authVerdict, parseMail } from "./risk";

/**
 * Atualizações, convites e contatos vindos de e-mail (F14/M6, plano §2.3, §2.4, F14-2, F14-3). O e-mail vira nota
 * datada na candidatura; a etapa é sugerida ou movida sozinha (só com confiança alta, remetente confiável e acerto
 * comprovado); o convite `.ics` da empresa vira o evento oficial da etapa; sem `.ics`, o horário combinado vira uma
 * etapa provisória que a pessoa bloqueia por clique; remarcação e cancelamento atualizam o mesmo evento.
 */
export const MAIL_UPDATE_CLASSES = ["update", "interview_invite", "recruiter_contact"] as const;

export const MAIL_AUTO_STAGE_KEY = "mail.autoStage";
/** Faixa de confiança alta (0–100) em que o automático pode agir. */
export const AUTO_STAGE_MIN_CONFIDENCE = 90;
export const AUTO_STAGE_MIN_DECISIONS = 20;
export const AUTO_STAGE_MIN_ACCURACY = 0.95;
/** Um desfazer recente volta ao modo sugestão (§2.4). */
export const AUTO_STAGE_UNDO_COOLDOWN_DAYS = 7;
/**
 * Janela de correção (§2.4): trocar a etapa à mão para trás neste prazo depois de uma decisão do e-mail conta como
 * correção; o automático só conta como acerto depois dela, sem desfazer nem correção.
 */
export const STAGE_CORRECTION_WINDOW_DAYS = 7;
/** Troca para outra etapa (para a frente) logo depois da decisão também é correção (o e-mail errou o passo). */
const QUICK_CORRECTION_MS = 24 * 3_600_000;

const DAY = 86_400_000;

export type StageLearningReason = "off" | "few_decisions" | "low_accuracy" | "recent_undo";

export interface StageLearning {
  /** A pessoa deixa o automático agir (Configurações); o padrão é sim. */
  allowed: boolean;
  /** Decisões na faixa de confiança alta. */
  decisions: number;
  /** Acerto ponderado (erro pesa o dobro), 0–1; null sem decisões. */
  accuracy: number | null;
  /** Último desfazer de um automático. */
  lastUndoAt: string | null;
  /** O automático está agindo agora. */
  active: boolean;
  /** Por que não está agindo (código para a interface traduzir). */
  reason: StageLearningReason | null;
  minDecisions: number;
  minAccuracy: number;
}

/**
 * Acerto do movimento de etapa (§2.4): aprovada como sugerida = acerto; automático sem desfazer nem correção depois da
 * janela = acerto; recusada, desfeita, corrigida ou aprovada com outra etapa = erro (pesa o dobro).
 */
export function stageLearning(repos: Repos, now = new Date()): StageLearning {
  const allowed = repos.settings.get<boolean>(MAIL_AUTO_STAGE_KEY) ?? true;
  const decided = repos.stageSuggestions.decided(AUTO_STAGE_MIN_CONFIDENCE);
  let ok = 0;
  let bad = 0;
  let lastUndoAt: string | null = null;
  const settled = (s: StageSuggestion) =>
    now.getTime() - Date.parse(s.createdAt) >= STAGE_CORRECTION_WINDOW_DAYS * DAY;
  for (const s of decided) {
    if (s.decision === "approved" || (s.mode === "auto" && s.decision === null && settled(s))) ok++;
    else if (s.decision) bad++;
    if (s.decision === "undone" && s.decidedAt && (!lastUndoAt || s.decidedAt > lastUndoAt))
      lastUndoAt = s.decidedAt;
  }
  const decisions = ok + bad;
  const accuracy = decisions ? ok / (ok + 2 * bad) : null;
  const cooling =
    !!lastUndoAt && now.getTime() - Date.parse(lastUndoAt) < AUTO_STAGE_UNDO_COOLDOWN_DAYS * DAY;
  let reason: StageLearningReason | null = null;
  if (!allowed) reason = "off";
  else if (decisions < AUTO_STAGE_MIN_DECISIONS) reason = "few_decisions";
  else if ((accuracy ?? 0) < AUTO_STAGE_MIN_ACCURACY) reason = "low_accuracy";
  else if (cooling) reason = "recent_undo";
  return {
    allowed,
    decisions,
    accuracy,
    lastUndoAt,
    active: reason === null,
    reason,
    minDecisions: AUTO_STAGE_MIN_DECISIONS,
    minAccuracy: AUTO_STAGE_MIN_ACCURACY,
  };
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Grupos de palavras da mesma etapa (pt e en), para ligar a dica do e-mail à etapa da candidatura. */
const STAGE_WORDS: RegExp[] = [
  /\b(rh|recursos humanos|hr|recruit\w*|recrut\w*|triagem|screening|talent|people|bate papo inicial|conversa inicial)\b/,
  /\b(tecnic\w*|technical|tech|coding|live coding|pair\w*|system design|arquitetura)\b/,
  /\b(teste|test|case|desafio|challenge|assessment|take home|exercicio|prova)\b/,
  /\b(gestor\w*|manager|lideranca|lider|hiring manager|head)\b/,
  /\b(cultur\w*|fit|valores|values|behavioral|comportamental)\b/,
  /\b(final|diretor\w*|director|executiv\w*|c level|ceo|cto)\b/,
  /\b(proposta|offer|oferta)\b/,
];

/** Etapa da candidatura que a dica descreve: vocabulário aprendido → nome igual → contém → mesmo grupo de palavras. */
export function matchStage(
  repos: Repos,
  app: JobApplication,
  hint: string,
  ctx: { company: string | null; platform: string | null },
): { stage: JobApplicationStage; via: "aprendido" | "nome" | "palavras" } | null {
  const h = plain(hint);
  if (!h) return null;
  const learned = repos.stageSuggestions.learned(
    hint,
    ctx.company ? normalizeIdentityPart(ctx.company) : null,
    ctx.platform,
  )[0];
  if (learned) {
    const name = plain(learned.correctedStageName ?? learned.toStageName);
    const s = app.stages.find((x) => plain(x.name) === name);
    if (s) return { stage: s, via: "aprendido" };
  }
  const exact = app.stages.find((s) => plain(s.name) === h);
  if (exact) return { stage: exact, via: "nome" };
  const contains = app.stages.filter((s) => {
    const n = plain(s.name);
    return n.length > 2 && (h.includes(n) || n.includes(h));
  });
  if (contains.length === 1) return { stage: contains[0] as JobApplicationStage, via: "nome" };
  for (const re of STAGE_WORDS) {
    if (!re.test(h)) continue;
    const same = app.stages.filter((s) => re.test(plain(s.name)));
    if (same.length === 1) return { stage: same[0] as JobApplicationStage, via: "palavras" };
  }
  return null;
}

/**
 * A pessoa trocou a etapa à mão (F14-2): sugestão aberta para esta etapa = aprovada; sugestões abertas para etapas
 * que ficaram para trás saem (desatualizadas, não contam); a decisão recente do e-mail vira correção só se a pessoa
 * voltou para antes da etapa aplicada, ou trocou logo depois dela (avançar no processo não é correção).
 */
export function learnFromManualStage(
  repos: Repos,
  applicationId: string,
  stageId: string | null,
  now = new Date(),
) {
  const at = now.toISOString();
  const app = repos.jobApplications.get(applicationId);
  if (!app || app.currentStageId === stageId) return;
  const pos = (id: string | null) => app.stages.findIndex((s) => s.id === id);
  const target = pos(stageId);
  const name = app.stages.find((s) => s.id === stageId)?.name ?? null;
  for (const s of repos.stageSuggestions.open(applicationId)) {
    if (!s.toStageId) continue;
    if (s.toStageId === stageId) {
      repos.stageSuggestions.decide(s.id, "approved", at);
      repos.stageSuggestions.setApplied(s.id, stageId);
    } else if (pos(s.toStageId) <= target) repos.stageSuggestions.remove(s.id);
  }
  const recent = repos.stageSuggestions
    .forApplication(applicationId)
    .find(
      (s) =>
        (s.decision === "approved" || (s.mode === "auto" && s.decision === null)) &&
        !!s.appliedStageId &&
        now.getTime() - Date.parse(s.decidedAt ?? s.createdAt) < STAGE_CORRECTION_WINDOW_DAYS * DAY,
    );
  if (!recent || recent.appliedStageId !== app.currentStageId) return;
  const back = target < pos(recent.appliedStageId);
  const quick =
    now.getTime() - Date.parse(recent.decidedAt ?? recent.createdAt) < QUICK_CORRECTION_MS;
  if (back || quick) repos.stageSuggestions.decide(recent.id, "corrected", at, name);
}

export interface MailUpdatesResult {
  /** Contatos de recrutador sem candidatura (registrados no e-mail). */
  contacts: number;
  noted: number;
  moved: number;
  suggested: number;
  events: number;
  review: number;
  /** F15: tarefas criadas pelas ações pedidas nos e-mails. */
  todos: number;
}

const userTz = (repos: Repos) => repos.users.get()?.timezone || "America/Sao_Paulo";

const mailNote = (repos: Repos, msg: MailMessageRecord, cls: MailClassifyOutput) => {
  const title =
    cls.class === "interview_invite"
      ? "Convite de entrevista"
      : cls.class === "recruiter_contact"
        ? "Contato de recrutador"
        : "Atualização da candidatura";
  return [
    `${title} (e-mail de ${msg.fromName ?? msg.fromAddr ?? "remetente desconhecido"}, ${formatInUserTz(msg.receivedAt, userTz(repos), "DD/MM/YYYY HH:mm")})`,
    msg.subject ? `Assunto: ${msg.subject}` : null,
    cls.stageHint ? `Etapa: ${cls.stageHint}` : null,
    cls.summary,
    `Abrir no Gmail: https://mail.google.com/mail/u/0/#all/${msg.gmailId}`,
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * Candidatura do e-mail: vaga escolhida na revisão → mesma conversa (thread) de um e-mail já ligado → vaga do e-mail →
 * a última candidatura dela.
 */
function applicationOf(
  repos: Repos,
  msg: MailMessageRecord,
  cls: MailClassifyOutput,
): JobApplication | { review: string } | null {
  const forced = (cls as { forcedPostingId?: string }).forcedPostingId;
  if (forced) return repos.jobApplications.latestForPosting(forced);
  if (msg.threadId) {
    const row = repos.db
      .prepare(
        `select json_extract(result_json, '$.applicationId') as app from mail_message
           where thread_id = ? and id <> ? and json_extract(result_json, '$.applicationId') is not null
             and undone_at is null
           order by received_at desc limit 1`,
      )
      .get(msg.threadId, msg.id) as { app: string | null } | undefined;
    const app = row?.app ? repos.jobApplications.get(row.app) : null;
    if (app) return app;
  }
  const r = resolveMailPosting(repos, cls);
  if (r.kind === "ambiguous") return { review: r.reason };
  if (r.kind === "none") return null;
  return repos.jobApplications.latestForPosting(r.posting.id);
}

/** Remetente sem confiança pediria uma mudança que precisa de confirmação (remarcar, cancelar, trocar a provisória). */
class NeedsConfirm extends Error {}

/** Data e hora do convite escrito no e-mail (ISO com deslocamento, ou local no fuso dito ou no da pessoa). */
export function interviewInstant(
  i: NonNullable<MailClassifyOutput["interview"]>,
  fallbackTz: string,
): string | null {
  const s = i.startsAt?.trim();
  if (!s) return null;
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const local = s.replace(" ", "T").slice(0, 16);
  try {
    return localToUtc(local, i.timeZone || fallbackTz);
  } catch {
    try {
      return localToUtc(local, fallbackTz);
    } catch {
      return null;
    }
  }
}

interface Ctx {
  repos: Repos;
  dataDir: string;
  ctx: Pick<ScheduledContext, "log" | "item" | "count" | "publish">;
}

type Pub = Parameters<ScheduledContext["publish"]>[0];

/** A autenticação do Gmail (DMARC, DKIM ou SPF) confere com o domínio do remetente (F15-5). */
export async function mailAuthAligned(dataDir: string, msg: MailMessageRecord): Promise<boolean> {
  try {
    const parsed = await parseMail(readFileSync(join(dataDir, msg.rawPath)));
    return authVerdict(parsed.authResults, domainOfAddress(msg.fromAddr)).aligned;
  } catch {
    return false;
  }
}

/** Convites `.ics` anexados ao e-mail (o `.eml` guardado). */
async function calendarsOf(dataDir: string, msg: MailMessageRecord) {
  try {
    const parsed = await parseMail(readFileSync(join(dataDir, msg.rawPath)));
    return parsed.attachments
      .filter((a) => /\.ics$/i.test(a.filename) || /text\/calendar/i.test(a.contentType))
      .map((a) => parseIcs(a.content));
  } catch {
    return [];
  }
}

export async function applyMailUpdates(
  input: Ctx & { limit?: number },
): Promise<MailUpdatesResult> {
  const { repos, ctx } = input;
  const out: MailUpdatesResult = {
    contacts: 0,
    noted: 0,
    moved: 0,
    suggested: 0,
    events: 0,
    review: 0,
    todos: 0,
  };
  // ordem com o M5 (revisão do M6, #13): nada mais novo que o e-mail de candidatura ou negativa ainda pendente
  const barrier = minIso(
    oldestUnclassified(repos),
    oldestPendingOf(repos, [...MAIL_APPLICATION_CLASSES]),
  );
  const learning = stageLearning(repos);
  for (const msg of repos.mail.byClasses([...MAIL_UPDATE_CLASSES], "pending", input.limit ?? 100)) {
    if (barrier && msg.receivedAt > barrier) continue;
    const cls = msg.result as unknown as MailClassifyOutput | null;
    if (!cls) continue;
    const at = new Date().toISOString();
    const label = msg.subject ?? "(sem assunto)";
    const calendars =
      cls.class === "recruiter_contact" ? [] : await calendarsOf(input.dataDir, msg);
    const events: Pub[] = [];
    const ctl = cls as MailClassifyOutput & { confirmed?: boolean; forcedPostingId?: string };
    const aligned = (cls.actions ?? []).length ? await mailAuthAligned(input.dataDir, msg) : false;
    const toReview = (reason: string, extra: Record<string, unknown> = {}) => {
      repos.mail.setResult(
        msg.id,
        {
          status: "review",
          class: cls.class,
          confidence: msg.confidence,
          result: { ...cleanControl(cls), ...extra, review: reason },
        },
        at,
      );
      out.review++;
    };
    try {
      const done = withTransaction(repos.db, () => {
        const found = applicationOf(repos, msg, cls);
        if (!found || "review" in found) {
          if (cls.class === "recruiter_contact" && !found) {
            // contato sem candidatura: fica registrado no e-mail (o feed de contatos é sugestão futura)
            repos.mail.setResult(
              msg.id,
              { status: "done", class: cls.class, confidence: msg.confidence, result: cls },
              at,
            );
            return {
              app: null,
              action: "contato de recrutador sem candidatura",
              counts: { contacts: 1, noted: 0, moved: 0, suggested: 0, events: 0 },
            };
          }
          const reason = found ? found.review : "nenhuma candidatura para este e-mail";
          toReview(reason);
          return { app: null, action: `para revisão: ${reason}` };
        }
        let app = found;
        const undo: MailUndo = {};
        const trusted =
          msg.riskLevel === "trusted" || ctl.confirmed === true || !!ctl.forcedPostingId;
        const tz = userTz(repos);
        const posting = repos.postings.get(app.postingId);
        const company = posting?.company ?? null;
        const platform =
          ((posting?.sourceRef as { platform?: string | null } | null)?.platform as
            | string
            | null
            | undefined) ?? null;
        const entry = addJobApplicationEntry(repos, input.dataDir, app.id, {
          occurredOn: formatInUserTz(msg.receivedAt, tz, "YYYY-MM-DD"),
          body: mailNote(repos, msg, cls),
          files: [],
        });
        undo.entryIds = [entry.id];
        const counts = { contacts: 0, noted: 1, moved: 0, suggested: 0, events: 0, todos: 0 };
        const actions: string[] = ["nota"];
        const closedAtIso = app.column === "closed" ? closedAt(repos, app.id) : null;
        // F15-6: as fases do e-mail trocam as etapas padrão (sem edição da pessoa); senão ficam como sugestão
        const proc = app.column !== "closed" ? cleanProcess(cls.process) : null;
        let processSuggestion: { stages: string[]; current: string | null } | null = null;
        if (proc && hasDefaultStages(app)) {
          undo.stages = {
            applicationId: app.id,
            before: app.stages.map((s) => s.name),
            beforeCurrent: app.stages.find((s) => s.id === app.currentStageId)?.name ?? null,
            after: proc.stages,
          };
          app = repos.jobApplications.setStages(
            app.id,
            proc.stages.map((name) => ({ name })),
          );
          // a atual fica na mesma posição (a primeira, numa candidatura nova); a do e-mail vem pela sugestão abaixo
          actions.push(`etapas trocadas pelas ${proc.stages.length} fases do e-mail`);
        } else if (proc && proc.stages.join("\n") !== app.stages.map((s) => s.name).join("\n")) {
          processSuggestion = proc;
          actions.push("fases do processo sugeridas");
        }
        const stageHint = cls.stageHint ?? proc?.current ?? null;
        const target = stageHint ? matchStage(repos, app, stageHint, { company, platform }) : null;
        if (app.column !== "closed") {
          // etapa (F14-2): só para a frente, e só se a dica casa com uma etapa da candidatura
          const pos = (id: string | null) => app.stages.findIndex((s) => s.id === id);
          if (stageHint && (!target || pos(target.stage.id) > pos(app.currentStageId))) {
            const confidence =
              target?.via === "aprendido" ? Math.max(cls.confidence, 95) : cls.confidence;
            const auto =
              !!target && trusted && learning.active && confidence >= AUTO_STAGE_MIN_CONFIDENCE;
            const s = repos.stageSuggestions.create(
              {
                mailMessageId: msg.id,
                applicationId: app.id,
                fromStageId: app.currentStageId,
                toStageId: target?.stage.id ?? null,
                toStageName: target?.stage.name ?? stageHint,
                hint: stageHint,
                company: company ? normalizeIdentityPart(company) : null,
                platform,
                confidence,
                mode: auto ? "auto" : "suggested",
              },
              at,
            );
            undo.suggestionIds = [s.id];
            if (auto && target) {
              repos.jobApplications.setCurrentStage(app.id, target.stage.id, new Date(), {
                source: "email",
                at: msg.receivedAt,
                mailMessageId: msg.id,
              });
              repos.stageSuggestions.setApplied(s.id, target.stage.id);
              undo.stage = {
                applicationId: app.id,
                fromStageId: app.currentStageId,
                toStageId: target.stage.id,
              };
              counts.moved++;
              actions.push(`etapa movida para ${target.stage.name}`);
            } else {
              counts.suggested++;
              actions.push(`etapa sugerida: ${s.toStageName}`);
              const { notification, created } = repos.notifications.upsert({
                kind: "mail.stage_suggestion",
                subjectKind: "job_application",
                subjectId: app.id,
                title: `Etapa sugerida por e-mail: ${s.toStageName}`,
                body: cls.summary,
                actionUrl: `/candidaturas/${app.id}`,
                severity: "info",
              });
              events.push({
                type: created ? "notification.created" : "notification.updated",
                notification,
              });
            }
          }
        }
        // convites (F14-3): na candidatura ativa, ou na encerrada se o e-mail é de antes do encerramento
        if (app.column !== "closed" || (closedAtIso && msg.receivedAt < closedAtIso)) {
          const notes: string[] = [];
          const eventActions = applyInvite(repos, {
            app,
            msg,
            cls,
            calendars,
            stageId: target?.stage.id ?? app.currentStageId,
            trusted,
            tz,
            undo,
            notify: (line) => notes.push(line),
          });
          counts.events += eventActions.length;
          actions.push(...eventActions);
          if (notes.length) {
            // um aviso por e-mail, com todas as mudanças (revisão do M6, #23)
            const { notification, created } = repos.notifications.upsert({
              kind: "mail.interview",
              subjectKind: "job_application",
              subjectId: app.id,
              title: `Agenda pelo e-mail: ${company ?? "candidatura"}`,
              body: notes.join("\n"),
              actionUrl: `/candidaturas/${app.id}`,
              severity: "info",
            });
            events.push({
              type: created ? "notification.created" : "notification.updated",
              notification,
            });
          }
        }
        // F15-2: as ações pedidas viram tarefas; o link só de remetente confiável ou do domínio da vaga/empresa
        if (app.column !== "closed" && (cls.actions ?? []).length) {
          const made = createMailTodos(repos, {
            msg,
            actions: cls.actions ?? [],
            app,
            company,
            linkAllowed: trusted || (aligned && senderMatchesPosting(msg.fromAddr, posting)),
            at,
          });
          if (made.todos.length) {
            undo.todoIds = made.todos.map((t) => t.id);
            counts.todos += made.todos.length;
            actions.push(`${made.todos.length} tarefa(s)`);
            for (const n of made.notifications)
              events.push({
                type: n.created ? "notification.created" : "notification.updated",
                notification: n.notification,
              });
            events.push({ type: "todo.updated", todoId: null });
          }
        }
        repos.mail.addUndo(msg.id, undo);
        repos.mail.setResult(
          msg.id,
          {
            status: "done",
            class: cls.class,
            confidence: msg.confidence,
            result: {
              ...cleanControl(cls),
              postingId: app.postingId,
              applicationId: app.id,
              ...(processSuggestion ? { processSuggestion } : {}),
            },
          },
          at,
        );
        return { app, action: actions.join(", "), counts };
      });
      if ("counts" in done && done.counts) {
        out.contacts += done.counts.contacts;
        out.noted += done.counts.noted;
        out.moved += done.counts.moved;
        out.suggested += done.counts.suggested;
        out.events += done.counts.events;
        out.todos += (done.counts as { todos?: number }).todos ?? 0;
      }
      ctx.item(
        done.app
          ? {
              kind: "job_application",
              refId: done.app.id,
              label,
              action: done.action,
              href: `/candidaturas/${done.app.id}`,
            }
          : {
              kind: "mail",
              refId: msg.gmailId,
              label,
              action: done.action,
              result: "skipped",
            },
      );
      if (done.app) events.push({ type: "job_application.updated", applicationId: done.app.id });
      for (const e of events) await ctx.publish(e).catch(() => {});
    } catch (e) {
      if (e instanceof NeedsConfirm) {
        const app = applicationOf(repos, msg, cls);
        toReview(e.message, {
          needsConfirm: true,
          ...(app && !("review" in app) ? { suggestedPostingId: app.postingId } : {}),
        });
        ctx.item({
          kind: "mail",
          refId: msg.gmailId,
          label,
          action: "para revisão",
          result: "skipped",
          detail: e.message,
        });
        continue;
      }
      const error = e instanceof Error ? e.message : String(e);
      toReview(error);
      ctx.log("warn", `E-mail ${msg.gmailId} não foi aplicado (${error}); vai para a revisão`);
    }
  }
  if (out.moved) ctx.count("stages_moved", out.moved);
  if (out.suggested) ctx.count("stages_suggested", out.suggested);
  if (out.events) ctx.count("events", out.events);
  if (out.todos) ctx.count("todos", out.todos);
  return out;
}

const minIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Campos de controle da revisão saem do resultado. */
const cleanControl = (cls: MailClassifyOutput) => {
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

/** Até 1 dia entre a provisória e o convite oficial (ou a mesma etapa): é a mesma entrevista. */
const SAME_INTERVIEW_MS = 86_400_000;

/**
 * Convite (F14-3): `.ics` com UID → o evento oficial (cria, remarca, cancela; substitui a etapa provisória da mesma
 * entrevista e avisa do bloqueio que a pessoa fez); sem `.ics`, horário escrito no e-mail → etapa provisória.
 * Remetente sem confiança: o evento novo nasce provisório e sem link; remarcar, cancelar ou trocar a provisória pede
 * confirmação (revisão). Convite com SEQUENCE menor que a já recebida é ignorado; fuso desconhecido → provisório.
 */
function applyInvite(
  repos: Repos,
  i: {
    app: JobApplication;
    msg: MailMessageRecord;
    cls: MailClassifyOutput;
    calendars: ReturnType<typeof parseIcs>[];
    stageId: string | null;
    trusted: boolean;
    tz: string;
    undo: MailUndo;
    notify: (line: string) => void;
  },
): string[] {
  const { app, msg, cls } = i;
  const actions: string[] = [];
  const evRepo = repos.jobApplicationEvents;
  const confirm = (what: string) => {
    if (!i.trusted)
      throw new NeedsConfirm(`remetente ainda sem confiança: confirme antes de ${what}`);
  };
  /** Guarda o antes; depois de mudar, `done()` guarda como ficou (o desfazer só reverte se ainda estiver assim). */
  const remember = (id: string) => {
    const e = evRepo.get(id);
    if (!e) return () => {};
    const prev = {
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      durationMin: e.durationMin,
      timezone: e.timezone,
      location: e.location,
      link: e.link,
      provisional: e.provisional,
      icsUid: e.icsUid,
      cancelledAt: e.cancelledAt,
      mailMessageId: e.mailMessageId,
      remoteSequence: e.remoteSequence,
      afterStartsAt: e.startsAt,
      afterCancelledAt: e.cancelledAt,
    };
    i.undo.eventPrev = [...(i.undo.eventPrev ?? []), prev];
    return () => {
      const now = evRepo.get(id);
      if (!now) return;
      prev.afterStartsAt = now.startsAt;
      prev.afterCancelledAt = now.cancelledAt;
    };
  };
  const when = (iso: string) => formatInUserTz(iso, i.tz, "DD/MM HH:mm");
  let handled = false;
  for (const cal of i.calendars) {
    for (const ev of cal.events) {
      if (!ev.uid || !ev.start || ev.allDay) continue;
      handled = true;
      const cancel = /cancel/i.test(cal.method ?? "") || /cancel/i.test(ev.status ?? "");
      const existing = evRepo.byIcsUid(app.id, ev.uid);
      // convite mais antigo que o já recebido (encaminhado, fora de ordem): ignora
      if (existing?.remoteSequence != null && ev.sequence < existing.remoteSequence) continue;
      const durationMin = ev.end
        ? Math.max(15, Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 60000))
        : 60;
      if (cancel) {
        if (existing && !existing.cancelledAt) {
          confirm("cancelar a entrevista");
          const after = remember(existing.id);
          evRepo.setCancelled(existing.id, new Date().toISOString());
          evRepo.setMail(existing.id, { remoteSequence: ev.sequence, mailMessageId: msg.id });
          after();
          actions.push("entrevista cancelada");
          i.notify(
            `${existing.title} de ${when(existing.startsAt)} foi cancelada pela empresa.${existing.blockedAt ? " Libere o bloqueio que você fez na agenda." : ""}`,
          );
        }
        continue;
      }
      // fuso que o narnia não reconhece: o horário pode estar errado, fica provisório até a pessoa conferir
      const unsure = ev.timeZoneUnknown;
      const fields = {
        title: ev.summary?.trim() || i.cls.stageHint || "Entrevista",
        startsAt: ev.start,
        durationMin,
        timezone: ev.timeZone || i.tz,
        location: ev.location,
        link: i.trusted ? ev.conferenceUrl : null,
      };
      if (existing) {
        if (
          existing.startsAt === ev.start &&
          existing.durationMin === durationMin &&
          !existing.cancelledAt
        )
          continue;
        confirm("remarcar a entrevista");
        const after = remember(existing.id);
        evRepo.update(existing.id, fields);
        if (existing.cancelledAt) evRepo.setCancelled(existing.id, null);
        evRepo.setMail(existing.id, {
          remoteSequence: ev.sequence,
          mailMessageId: msg.id,
          ...(unsure ? { provisional: true } : {}),
        });
        after();
        actions.push("entrevista remarcada");
        i.notify(
          `${fields.title}: de ${when(existing.startsAt)} para ${when(ev.start)}.${existing.blockedAt ? " Ajuste o bloqueio que você fez na agenda." : ""}`,
        );
        continue;
      }
      // o oficial substitui a provisória da mesma entrevista (mesma etapa ou até 1 dia de diferença)
      const provisional = evRepo
        .list(app.id)
        .filter(
          (e) =>
            e.provisional &&
            !e.icsUid &&
            !e.cancelledAt &&
            !e.doneAt &&
            ((!!i.stageId && e.stageId === i.stageId) ||
              Math.abs(Date.parse(e.startsAt) - Date.parse(ev.start as string)) <=
                SAME_INTERVIEW_MS),
        )
        .sort(
          (a, b) =>
            Math.abs(Date.parse(a.startsAt) - Date.parse(ev.start as string)) -
            Math.abs(Date.parse(b.startsAt) - Date.parse(ev.start as string)),
        )[0];
      if (provisional) {
        confirm("trocar a etapa provisória pelo convite");
        const after = remember(provisional.id);
        evRepo.update(provisional.id, fields);
        evRepo.setMail(provisional.id, {
          provisional: unsure,
          icsUid: ev.uid,
          mailMessageId: msg.id,
          remoteSequence: ev.sequence,
        });
        after();
        actions.push("convite oficial no lugar da etapa provisória");
        i.notify(
          `Convite oficial: ${fields.title} em ${when(ev.start)}.${provisional.blockedAt ? " O bloqueio que você fez na agenda pode sair: o convite da empresa já ocupa o horário." : ""}`,
        );
        continue;
      }
      const created = evRepo.create(
        app.id,
        { ...fields, stageId: i.stageId, kind: "interview", notes: null },
        new Date(),
        {
          provisional: !i.trusted || unsure,
          icsUid: ev.uid,
          mailMessageId: msg.id,
          remoteSequence: ev.sequence,
        },
      );
      i.undo.eventIds = [...(i.undo.eventIds ?? []), created.id];
      actions.push("entrevista marcada (convite)");
      i.notify(
        `Entrevista marcada: ${fields.title} em ${when(ev.start)}.${unsure ? " O fuso do convite não foi reconhecido: confira o horário." : ""}`,
      );
    }
  }
  if (!handled && cls.class === "interview_invite" && cls.interview) {
    const startsAt = interviewInstant(cls.interview, i.tz);
    if (startsAt) {
      const dup = repos.jobApplicationEvents
        .list(app.id)
        .some((e) => e.startsAt === startsAt && !e.cancelledAt);
      if (!dup) {
        const created = evRepo.create(
          app.id,
          {
            stageId: i.stageId,
            kind: "interview",
            title: cls.stageHint || "Entrevista",
            startsAt,
            durationMin: cls.interview.durationMin ?? 60,
            timezone: cls.interview.timeZone || i.tz,
            location: cls.interview.location,
            link: i.trusted ? cls.interview.link : null,
            notes: null,
          },
          new Date(),
          { provisional: true, mailMessageId: msg.id },
        );
        i.undo.eventIds = [...(i.undo.eventIds ?? []), created.id];
        actions.push("etapa provisória");
        i.notify(
          `Entrevista combinada: ${created.title} em ${when(startsAt)}, sem convite da empresa ainda. Bloqueie a agenda na candidatura se quiser.`,
        );
      }
    }
  }
  return actions;
}

export type { StageSuggestion };

export class StageSuggestionError extends Error {
  constructor(
    readonly code: "not_found" | "decided" | "stage_required" | "stage_not_found" | "stale",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Aprovar a sugestão (F14-2): move para a etapa sugerida, ou para a escolhida. Escolher outra etapa quando havia uma
 * sugerida conta como correção (erro do e-mail); quando a dica não casou com nenhuma, a escolha só ensina o vocabulário.
 * Sugestão para candidatura encerrada ou para etapa anterior à atual está desatualizada (409).
 */
export function approveStageSuggestion(
  repos: Repos,
  id: string,
  stageId: string | null | undefined,
  now = new Date(),
): JobApplication {
  const s = repos.stageSuggestions.get(id);
  if (!s) throw new StageSuggestionError("not_found", "Sugestão não encontrada");
  if (s.decision || s.mode !== "suggested")
    throw new StageSuggestionError("decided", "Sugestão já decidida");
  const app = repos.jobApplications.get(s.applicationId);
  if (!app) throw new StageSuggestionError("not_found", "Candidatura não encontrada");
  if (app.column === "closed")
    throw new StageSuggestionError("stale", "A candidatura está encerrada");
  const target = stageId ?? s.toStageId;
  if (!target) throw new StageSuggestionError("stage_required", "Escolha a etapa");
  const stage = app.stages.find((x) => x.id === target);
  if (!stage) throw new StageSuggestionError("stage_not_found", "Etapa não é desta candidatura");
  const pos = (sid: string | null) => app.stages.findIndex((x) => x.id === sid);
  if (pos(stage.id) < pos(app.currentStageId))
    throw new StageSuggestionError("stale", "A candidatura já passou desta etapa");
  return withTransaction(repos.db, () => {
    const other = !!s.toStageId && stage.id !== s.toStageId;
    repos.stageSuggestions.decide(
      id,
      other ? "corrected" : "approved",
      now.toISOString(),
      stage.id === s.toStageId ? null : stage.name,
    );
    repos.stageSuggestions.setApplied(id, stage.id);
    // o desfazer do e-mail também volta esta mudança (revisão do M6, #9)
    repos.mail.addUndo(s.mailMessageId, {
      stage: { applicationId: app.id, fromStageId: app.currentStageId, toStageId: stage.id },
    });
    return repos.jobApplications.setCurrentStage(app.id, stage.id, now, {
      source: "suggestion",
      mailMessageId: s.mailMessageId,
    });
  });
}

export function rejectStageSuggestion(repos: Repos, id: string, now = new Date()): void {
  const s = repos.stageSuggestions.get(id);
  if (!s) throw new StageSuggestionError("not_found", "Sugestão não encontrada");
  if (s.decision || s.mode !== "suggested")
    throw new StageSuggestionError("decided", "Sugestão já decidida");
  repos.stageSuggestions.decide(id, "rejected", now.toISOString());
}

/** Sugestões abertas de uma candidatura saem da notificação quando não sobra nenhuma. */
export function resolveStageSuggestionNotification(repos: Repos, applicationId: string) {
  if (repos.stageSuggestions.open(applicationId).length) return [];
  return repos.notifications.resolveSubject("job_application", applicationId, [
    "mail.stage_suggestion",
  ]);
}
