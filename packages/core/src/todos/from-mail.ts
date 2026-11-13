import type {
  JobApplication,
  MailClassifyOutput,
  Notification,
  TodoKind,
} from "@narnia-jobs/shared";
import { TODO_KINDS } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { MailMessageRecord } from "../db/repos/mail";
import type { TodoRecord } from "../db/repos/todos";
import { DEFAULT_STAGES } from "../job-applications";
import { domainOfAddress, isWebmail, platformOf, registrableDomain } from "../mail/domains";
import { TODO_KIND_TAG } from "./index";
import { todoUrl } from "./notify";

/**
 * E-mail → tarefas e fases (F15/M3, plano §2.3).
 *
 * - Cada ação que o e-mail pede (triagem, teste, formulário, documentos, horário) vira uma tarefa em "A fazer", com o
 *   prazo e as tags (empresa, `e-mail`, o tipo). O link da ação só entra quando o remetente é confiável (ou do domínio
 *   da vaga ou da empresa da candidatura): de remetente sem confiança a tarefa nasce sem link, com a tag `confira`.
 *   Tarefa do mesmo tipo ainda aberta na mesma candidatura não se repete.
 * - As fases do processo trocam as etapas da candidatura só se ela ainda tem as etapas padrão (F15-6); senão ficam
 *   guardadas no resultado do e-mail para a pessoa aplicar.
 */
export type MailAction = NonNullable<MailClassifyOutput["actions"]>[number];

const isKind = (k: unknown): k is TodoKind => TODO_KINDS.includes(k as TodoKind);

/** Tag da empresa: minúsculas, sem acento, palavras unidas por hífen. */
export const companyTag = (company: string | null | undefined): string | null => {
  const t = (company ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return t || null;
};

const validDue = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** O texto do resultado é do modelo: títulos curtos e limpos. */
const cleanTitle = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

export interface MailTodosResult {
  todos: TodoRecord[];
  notifications: Array<{ notification: Notification; created: boolean }>;
}

/** Cria as tarefas das ações do e-mail (dentro da transação de quem chama); devolve as criadas e os avisos. */
export function createMailTodos(
  repos: Repos,
  input: {
    msg: MailMessageRecord;
    actions: MailAction[];
    app: JobApplication;
    company: string | null;
    /** Remetente confiável, do domínio da vaga ou da empresa, ou confirmado pela pessoa: o link da ação vale. */
    linkAllowed: boolean;
    at: string;
  },
): MailTodosResult {
  const out: MailTodosResult = { todos: [], notifications: [] };
  const open = repos.todos
    .list({ applicationId: input.app.id }, input.at)
    .filter((t) => t.status !== "done");
  for (const a of input.actions.slice(0, 5)) {
    const title = cleanTitle(a.title ?? "");
    if (!title) continue;
    const kind: TodoKind = isKind(a.kind) ? a.kind : "other";
    if (open.some((t) => t.kind === kind && t.source === "email")) continue;
    const link = input.linkAllowed ? a.url : null;
    const tags = [
      companyTag(input.company),
      "e-mail",
      TODO_KIND_TAG[kind],
      input.linkAllowed || !a.url ? null : "confira",
    ].filter((t): t is string => !!t);
    const t = repos.todos.create(
      {
        title,
        note:
          input.linkAllowed || !a.url
            ? null
            : "O remetente não é confiável: o link da ação ficou de fora. Confira no e-mail antes de clicar.",
        status: "todo",
        dueAt: validDue(a.dueAt),
        actionUrl: link,
        source: "email",
        kind,
        tags,
        applicationId: input.app.id,
        postingId: input.app.postingId,
        mailMessageId: input.msg.id,
      },
      input.at,
    );
    open.push(t);
    out.todos.push(t);
    out.notifications.push(
      repos.notifications.upsert({
        kind: "todo.created",
        subjectKind: "todo",
        subjectId: t.id,
        title: `Nova tarefa: ${t.title}`,
        body: input.company ? `${input.company} · pelo e-mail` : "pelo e-mail",
        actionUrl: todoUrl(t.id),
      }),
    );
  }
  return out;
}

/** Candidatura com as etapas padrão, na ordem, sem edição: as fases do e-mail podem trocar sozinhas (F15-6). */
export const hasDefaultStages = (app: JobApplication) =>
  app.stages.length === DEFAULT_STAGES.length &&
  app.stages.every((s, i) => s.name === DEFAULT_STAGES[i]);

/** Fases úteis: 2 a 12 nomes, curtos, sem repetição. */
export function cleanProcess(
  p: MailClassifyOutput["process"] | undefined,
): { stages: string[]; current: string | null } | null {
  if (!p) return null;
  const seen = new Set<string>();
  const stages = (p.stages ?? [])
    .map((s) => cleanTitle(s).slice(0, 80))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  if (stages.length < 2 || stages.length > 12) return null;
  const current = p.current ? cleanTitle(p.current).slice(0, 80) : null;
  return { stages, current: current || null };
}

/** Nome da empresa só com letras e números ("K&M" → "kandm", "km" e "kem"), para comparar com o domínio. */
const companyKeys = (company: string | null | undefined): string[] => {
  const base = (company ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const keys = ["and", "", "e"].map((amp) => base.replace(/&/g, amp).replace(/[^a-z0-9]/g, ""));
  return [...new Set(keys)].filter((k) => k.length >= 3);
};

/**
 * O remetente é do domínio da vaga ou da empresa que a pessoa espera (F15-5, regra do dono 2026-11-12): o mesmo domínio
 * registrável do link da vaga ou do site da empresa (fora quadros de vagas e webmail), ou o nome da empresa no domínio
 * ("K&M" em `kandm.example`). Quem chama confere também a autenticação do e-mail.
 */
export function senderMatchesPosting(
  fromAddr: string | null,
  posting: {
    company: string | null;
    postingUrl?: string | null;
    companyUrl?: string | null;
  } | null,
): boolean {
  const domain = domainOfAddress(fromAddr);
  if (!domain || !posting || isWebmail(domain)) return false;
  const reg = registrableDomain(domain);
  for (const raw of [posting.postingUrl, posting.companyUrl]) {
    if (!raw) continue;
    try {
      const d = registrableDomain(new URL(raw).hostname.toLowerCase());
      if (d === reg && !platformOf(d)) return true;
    } catch {
      // link inválido não decide
    }
  }
  if (platformOf(reg)) return false;
  const label = reg.split(".")[0] ?? "";
  return companyKeys(posting.company).some((k) => label === k || label.includes(k));
}

export class MailProcessError extends Error {
  constructor(
    readonly code: "not_found" | "no_suggestion",
    message: string,
  ) {
    super(message);
    this.name = "MailProcessError";
  }
}

/**
 * "Aplicar as fases" (F15-6): a candidatura com etapas editadas recebeu as fases de um e-mail como sugestão; a pessoa
 * aceita e as etapas viram as fases, com a atual na fase que o e-mail marca. O Desfazer do e-mail devolve as de antes.
 */
export function applyMailProcess(repos: Repos, mailId: string, now = new Date()) {
  const msg = repos.mail.get(mailId);
  const r = (msg?.result ?? null) as {
    applicationId?: string;
    processSuggestion?: { stages: string[]; current: string | null };
  } | null;
  if (!msg || !r?.applicationId) throw new MailProcessError("not_found", "E-mail não encontrado");
  const app = repos.jobApplications.get(r.applicationId);
  const p = r.processSuggestion;
  if (!app || !p) throw new MailProcessError("no_suggestion", "Este e-mail não sugere fases");
  repos.mail.addUndo(msg.id, {
    stages: {
      applicationId: app.id,
      before: app.stages.map((s) => s.name),
      beforeCurrent: app.stages.find((s) => s.id === app.currentStageId)?.name ?? null,
      after: p.stages,
    },
  });
  let next = repos.jobApplications.setStages(
    app.id,
    p.stages.map((name) => ({ name })),
    now,
  );
  const cur = p.current ? next.stages.find((s) => s.name === p.current) : null;
  if (cur && cur.id !== next.currentStageId)
    next = repos.jobApplications.setCurrentStage(app.id, cur.id, now, {
      source: "email",
      at: msg.receivedAt,
      mailMessageId: msg.id,
    });
  const { processSuggestion: _p, ...rest } = r as Record<string, unknown>;
  repos.mail.setResult(
    msg.id,
    { status: msg.status, class: msg.class ?? "update", confidence: msg.confidence, result: rest },
    now.toISOString(),
  );
  return next;
}
