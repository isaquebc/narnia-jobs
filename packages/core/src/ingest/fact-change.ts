import {
  type FactChange,
  type FactChangeKind,
  type FactProposal,
  FactProposalSchema,
  nowUtc,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { IngestionRunRecord, RunModels } from "../db/repos/ingestion-runs";

/**
 * Alteração pequena pedida na conversa (pedido do dono, 2026-10-23): o recrutador nunca grava o fato. A alteração vira
 * uma ingestão de texto cuja fonte é o **registro dela** (fato, antes e depois por campo, motivo e o pedido literal do
 * usuário); a proposta é um conflito com o fato, já resolvido para o valor novo, e só vale depois que o usuário
 * confirma (no cartão da conversa, na tela da execução ou pela pendência). Aceita, a fonte nova do fato é a conversa.
 */

export interface FactChangeInput {
  kind: FactChangeKind;
  id: string;
  /** Campo → valor novo; null apaga um campo opcional. */
  changes: Record<string, unknown>;
  reason: string;
  /** Trecho literal da mensagem do usuário que pediu a alteração. */
  quote: string;
}

export interface FactChangePlan {
  change: FactChange;
  /** O fato inteiro com a alteração, como proposta da ingestão. */
  proposal: FactProposal;
}

export class FactChangeError extends Error {
  constructor(
    readonly code: "fact_not_found" | "invalid_change" | "no_change" | "quote_not_found",
    message: string,
  ) {
    super(message);
    this.name = "FactChangeError";
  }
}

const FIELDS: Record<FactChangeKind, string[]> = {
  experience: [
    "company",
    "title",
    "employmentType",
    "startDate",
    "endDate",
    "isCurrent",
    "location",
    "summary",
    "tech",
    "weeklyHours",
    "compensation",
    "benefits",
    "benefitsOther",
  ],
  achievement: ["text", "metric"],
  education: ["institution", "course", "degree", "startDate", "endDate", "status"],
  skill: ["name", "category", "level"],
  language: ["name", "level"],
  project: ["name", "description", "url", "role", "startDate", "endDate", "tech"],
};

type AnyRecord = Record<string, unknown>;

function factOf(repos: Repos, kind: FactChangeKind, id: string): AnyRecord | null {
  const repo = {
    experience: repos.facts.experiences,
    achievement: repos.facts.achievements,
    education: repos.facts.education,
    skill: repos.facts.skills,
    language: repos.facts.languages,
    project: repos.facts.projects,
  }[kind] as { get(id: string): unknown };
  return (repo.get(id) as AnyRecord | null) ?? null;
}

const clip = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Como o fato aparece para o usuário: "Cargo · Empresa", o nome da habilidade, o começo da conquista… */
export function factChangeLabel(kind: FactChangeKind, f: AnyRecord): string {
  const s = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
  const parts: Record<FactChangeKind, string[]> = {
    experience: [s("title"), s("company")],
    achievement: [clip(s("text"))],
    education: [s("course"), s("institution")],
    skill: [s("name")],
    language: [s("name")],
    project: [s("name")],
  };
  return parts[kind].filter(Boolean).join(" · ") || kind;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** O pedido está, literalmente (sem contar espaços e caixa), numa mensagem do usuário desta conversa. */
function quoteInSession(repos: Repos, sessionId: string, quote: string): boolean {
  const q = squash(quote);
  return repos.chatMessages
    .list(sessionId, { limit: 200 })
    .some((m) => m.role === "user" && squash(m.contentMd).includes(q));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function planFactChange(
  repos: Repos,
  input: FactChangeInput,
  opts: { sessionId: string | null },
): FactChangePlan {
  const fact = factOf(repos, input.kind, input.id);
  if (!fact)
    throw new FactChangeError("fact_not_found", `Fato não encontrado: ${input.kind} ${input.id}`);
  const allowed = FIELDS[input.kind];
  const unknown = Object.keys(input.changes).filter((k) => !allowed.includes(k));
  if (unknown.length)
    throw new FactChangeError(
      "invalid_change",
      `Campo que não dá para alterar em ${input.kind}: ${unknown.join(", ")}. Campos: ${allowed.join(", ")}.`,
    );
  const changes = Object.entries(input.changes)
    .filter(([k, v]) => !same(fact[k], v))
    .map(([field, after]) => ({ field, before: fact[field] ?? null, after: after ?? null }));
  if (!changes.length)
    throw new FactChangeError("no_change", "O fato já está assim: nada para alterar.");

  // o fato inteiro com a alteração precisa continuar válido (datas, níveis, categorias…)
  const data: AnyRecord = {};
  for (const k of allowed) if (fact[k] !== null && fact[k] !== undefined) data[k] = fact[k];
  if (input.kind === "achievement") data.experienceId = fact.experienceId;
  for (const c of changes) {
    if (c.after === null) delete data[c.field];
    else data[c.field] = c.after;
  }
  const parsed = FactProposalSchema.safeParse({ kind: input.kind, confidence: 1, data });
  if (!parsed.success)
    throw new FactChangeError(
      "invalid_change",
      `Valor inválido: ${parsed.error.issues.map((i) => `${i.path.slice(1).join(".")}: ${i.message}`).join("; ")}`,
    );

  const quoteFound = opts.sessionId ? quoteInSession(repos, opts.sessionId, input.quote) : false;
  if (opts.sessionId && !quoteFound)
    throw new FactChangeError(
      "quote_not_found",
      "O trecho do pedido não está nas mensagens do usuário desta conversa. Copie literalmente a frase em que ele pediu a alteração.",
    );
  return {
    change: {
      kind: input.kind,
      factId: input.id,
      label: factChangeLabel(input.kind, fact),
      changes,
      reason: input.reason,
      quote: input.quote,
      quoteFound,
    },
    proposal: parsed.data,
  };
}

const show = (v: unknown) => (v === null || v === undefined ? "(vazio)" : JSON.stringify(v));

/** O registro da alteração: é o texto da fonte da ingestão (a evidência literal sai dele). */
export function factChangeText(plan: FactChangePlan, at: string = nowUtc()): string {
  const c = plan.change;
  return [
    "# Alteração pedida na conversa",
    "",
    `Fato: ${c.kind} · ${c.label} (${c.factId})`,
    `Pedido em: ${at}`,
    "",
    ...c.changes.map((x) => `- ${x.field}: ${show(x.before)} → ${show(x.after)}`),
    "",
    `Motivo: ${c.reason}`,
    "",
    "Pedido do usuário:",
    `> ${c.quote}`,
    "",
  ].join("\n");
}

/**
 * A execução da alteração, já em revisão: uma proposta de conflito com o fato, resolvida para o valor novo, com o
 * pedido como evidência. A conversa que pediu não recebe o aviso de "ingestão pronta" (ela já sabe).
 */
export function createFactChangeRun(
  repos: Repos,
  plan: FactChangePlan,
  opts: { fileId: string; provider: string; models: RunModels; sessionId: string | null },
): IngestionRunRecord {
  const run = repos.ingestionRuns.create({
    fileId: opts.fileId,
    provider: opts.provider,
    models: opts.models,
    options: { ocr: false, modelRead: false },
  });
  repos.ingestionRuns.setParams(run.id, {
    ...run.params,
    factChange: plan.change,
    chat: { sessionId: opts.sessionId },
  });
  const [proposalId] = repos.proposals.insertMany(
    run.id,
    [plan.proposal],
    [{ ref: "conversa", quote: plan.change.quote }],
  );
  const id = proposalId as string;
  repos.proposals.setMatch(id, {
    match: "conflict",
    targetId: plan.change.factId,
    conflict: {
      targetId: plan.change.factId,
      fields: plan.change.changes.map((c) => ({
        field: c.field,
        current: c.before,
        proposed: c.after,
        currentSource: null,
        proposedSource: "conversa",
      })),
    },
  });
  repos.proposals.setResolution(
    id,
    Object.fromEntries(plan.change.changes.map((c) => [c.field, { choice: "use_new" as const }])),
  );
  repos.proposals.setCheckStatus(id, plan.change.quoteFound ? "supported" : "unchecked");
  if (opts.sessionId) {
    repos.ingestionRuns.linkChat(run.id, opts.sessionId);
    repos.ingestionRuns.claimChatNotice(run.id);
  }
  repos.ingestionRuns.setStatus(run.id, "review");
  return repos.ingestionRuns.get(run.id) as IngestionRunRecord;
}

/** A alteração pedida na conversa que esta execução carrega, se for uma. */
export function factChangeOf(run: IngestionRunRecord): FactChange | null {
  return (run.params.factChange as FactChange | undefined) ?? null;
}
