import {
  type EvidenceId,
  type JobAnalysis,
  JobAnalysisSchema,
  type Notification,
  normalizeLinkedinUrl,
  POSTING_TOOLS,
  type Posting,
  type PostingFields,
  type PostingRole,
  type PostingToolName,
  type PreAnalysis,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import { postingRef } from "../chat/citations";
import type { Repos } from "../db";
import type { JobAnalysisRecord } from "../db/repos/postings";
import { editPostingNote } from "./notes";
import { searchPostings } from "./search";

/**
 * Handlers das tools da vaga e da análise (F06 §2.4). O que depende da api (busca por URL, fila, conversa nova) entra
 * por portas; o resto é banco. Origem dos campos que o recrutador grava pela conversa: `user` (o dado veio do usuário;
 * o merge do modelo não sobrescreve).
 */
type In<N extends PostingToolName> = z.infer<(typeof POSTING_TOOLS)[N]["input"]>;
type Out<N extends PostingToolName> = z.infer<(typeof POSTING_TOOLS)[N]["output"]>;
export type PostingToolHandlers = { [N in PostingToolName]: (input: unknown) => Promise<Out<N>> };

export type IntakeOutcome =
  | { ok: true; posting: Posting }
  | { ok: false; code: string; message: string };

export interface PostingToolPorts {
  intake(input: {
    text?: string | undefined;
    url?: string | undefined;
    fields?: { [K in keyof PostingFields]?: PostingFields[K] | undefined } | undefined;
  }): Promise<IntakeOutcome>;
  /** Conversa própria da análise (modo A). Ausente no terminal: a análise segue na mesma conversa. */
  openAnalysis?(postingId: string): Promise<{ sessionId: string; title: string }>;
  /** A conversa mudou de categoria ou título (virou a da vaga): a api avisa a web (`chat.session_updated`). */
  sessionChanged?(sessionId: string): void;
  /** Vaga criada ou alterada pela conversa: a api avisa a web (`posting.updated`). */
  changed?(postingId: string): void;
  /** Pendências criadas ou resolvidas (nota do usuário editada pelo recrutador, F06-17). */
  notified?(events: Array<{ notification: Notification; created: boolean }>): void;
}

export class PostingToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const postingUrl = (id: string) => `/vagas/${id}`;

export const ROLE_LABELS: Record<PostingRole, string> = {
  backend: "Backend",
  frontend: "Frontend",
  fullstack: "Full Stack",
  mobile: "Mobile",
  data_engineering: "Engenharia de Dados",
  data_science: "Ciência de Dados",
  ml_engineering: "Machine Learning",
  devops_sre: "DevOps/SRE",
  platform: "Plataforma",
  qa: "QA",
  security: "Segurança",
  embedded: "Embarcados",
  architect: "Arquitetura",
  tech_lead: "Tech Lead",
  engineering_manager: "Engineering Manager",
  product_management: "Produto",
  product_design: "Design de Produto",
  support: "Suporte",
  other: "Outra",
};

/** Título da conversa da análise (F06 §1.1): "<contratante>/<cliente> - <role>". */
export function postingSessionTitle(
  p: Pick<Posting, "company" | "client" | "role" | "title">,
): string {
  const who = [p.company, p.client].filter(Boolean).join("/") || "Vaga";
  const what = p.role && p.role !== "other" ? ROLE_LABELS[p.role] : (p.title ?? "sem cargo");
  return `${who} - ${what}`.slice(0, 120);
}

/** Uma linha por vaga: empresa/cliente, cargo, role, senioridade e data de criação. */
export function postingLine(p: Posting): string {
  return [
    [p.company, p.client].filter(Boolean).join("/") || "(sem empresa)",
    p.title ?? (p.role ? ROLE_LABELS[p.role] : null),
    p.seniority,
    p.createdAt.slice(0, 10),
  ]
    .filter(Boolean)
    .join(" · ");
}

function brief(pre: PreAnalysis | null, profileId: string | null) {
  if (!pre) return null;
  const pick = (section: string) =>
    pre.keywords
      .filter((k) => k.section === section)
      .map((k) => ({ term: k.term, evidence: k.evidence.slice(0, 3) }));
  const risks = profileId
    ? (pre.risksByProfile[profileId] ?? [])
    : Object.values(pre.risksByProfile).flat();
  return {
    required: pick("required"),
    nice: pick("nice"),
    coverage: pre.coverage,
    risks: [...new Set(risks.map((r) => r.description))],
  };
}

/**
 * "Análise pronta" (correção 2026-10-15): a análise roda numa conversa, fora da fila, então a bandeja fica sabendo por
 * esta notificação informativa (uma aberta por vaga; uma reanálise volta a marcá-la como não vista).
 */
export function notifyPostingAnalysisDone(
  repos: Repos,
  posting: Posting,
): { notification: Notification; created: boolean } {
  const ev = repos.notifications.upsert({
    kind: "posting.analysis_done",
    subjectKind: "posting",
    subjectId: posting.id,
    title: `Análise pronta: ${postingSessionTitle(posting)}`,
    actionUrl: postingUrl(posting.id),
    severity: "info",
  });
  if (ev.created) return ev;
  return {
    notification: repos.notifications.markUnread(ev.notification.id) ?? ev.notification,
    created: false,
  };
}

/**
 * Conversa da análise que terminou o turno sem gravar a análise (correção 2026-10-15): vira pendência com o link da
 * conversa, para a bandeja não ficar muda. Só conversa `job` ligada a uma vaga e sem análise gravada por ela.
 */
export function notifyAnalysisIncomplete(
  repos: Repos,
  sessionId: string,
): { notification: Notification; created: boolean } | null {
  const s = repos.chatSessions.get(sessionId);
  if (s?.category !== "job" || !s.postingId) return null;
  if (repos.jobAnalyses.list(s.postingId).some((a) => a.chatSessionId === s.id)) return null;
  return repos.notifications.upsert({
    kind: "posting.analysis_incomplete",
    subjectKind: "chat_session",
    subjectId: s.id,
    title: `Análise não concluída: ${s.title}`,
    body: "A conversa da análise terminou sem gravar a análise. Abra a conversa para continuar ou peça de novo.",
    actionUrl: `/chat/${s.id}`,
    severity: "warning",
  });
}

/** Envelheceu (F06-10)? Fatos do usuário ou a vaga mudaram depois da análise. */
export function analysisStale(
  repos: Repos,
  record: Pick<JobAnalysisRecord, "factsVersion" | "postingUpdatedAt">,
  posting: Pick<Posting, "contentUpdatedAt">,
): { facts: boolean; posting: boolean } {
  return {
    facts: repos.settings.getFactsVersion() > record.factsVersion,
    // só mudança de conteúdo (usuário ou JD nova): status e extração terminando depois não envelhecem
    posting: posting.contentUpdatedAt > record.postingUpdatedAt,
  };
}

/** Rótulos legíveis das evidências da análise ("kind:id" → "Engenheira Sênior · Acme"), para a página da vaga. */
export function evidenceLabels(repos: Repos, analysis: JobAnalysis): Record<string, string> {
  const f = repos.facts;
  const label = (e: EvidenceId): string | null => {
    switch (e.kind) {
      case "experience": {
        const x = f.experiences.get(e.id);
        return x ? `${x.title} · ${x.company}` : null;
      }
      case "achievement":
        return f.achievements.get(e.id)?.text ?? null;
      case "project":
        return f.projects.get(e.id)?.name ?? null;
      case "skill":
        return f.skills.get(e.id)?.name ?? null;
      case "education": {
        const x = f.education.get(e.id);
        return x ? `${x.course} · ${x.institution}` : null;
      }
      case "language":
        return f.languages.get(e.id)?.name ?? null;
    }
  };
  const out: Record<string, string> = {};
  for (const e of [
    ...analysis.matches.flatMap((m) => m.evidence),
    ...analysis.likelyQuestions.flatMap((q) => q.evidence),
  ]) {
    const l = label(e);
    if (l) out[`${e.kind}:${e.id}`] = l;
  }
  return out;
}

/** Evidências da análise que não existem (o modelo não pode afirmar "atende" com fato inventado). */
export function missingEvidence(repos: Repos, analysis: JobAnalysis): EvidenceId[] {
  const f = repos.facts;
  const exists: Record<EvidenceId["kind"], (id: string) => boolean> = {
    experience: (id) => f.experiences.get(id) !== null,
    achievement: (id) => f.achievements.get(id) !== null,
    project: (id) => f.projects.get(id) !== null,
    skill: (id) => f.skills.get(id) !== null,
    education: (id) => f.education.get(id) !== null,
    language: (id) => f.languages.get(id) !== null,
  };
  const all = [
    ...analysis.matches.flatMap((m) => m.evidence),
    ...analysis.likelyQuestions.flatMap((q) => q.evidence),
  ];
  return all.filter((e) => !exists[e.kind](e.id));
}

/** Vagas que o usuário arquivou por falta de fit (F07/M1.6), mais recentes primeiro: o especializado pesa o motivo no fit. */
export function discardedPostings(repos: Repos, exceptId: string, limit = 10) {
  return repos.postings
    .list()
    .filter((o) => o.id !== exceptId && o.archivedAt !== null && o.archiveReason !== null)
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""))
    .slice(0, limit)
    .map((o) => ({
      id: o.id,
      line: postingLine(o),
      reason: o.archiveReason as NonNullable<Posting["archiveReason"]>,
      note: o.archiveNote,
      archivedOn: (o.archivedAt ?? "").slice(0, 10),
    }));
}

export function createPostingTools(
  repos: Repos,
  ctx: { ports: PostingToolPorts; sessionId?: string | null },
): PostingToolHandlers {
  const wrap = <N extends PostingToolName>(
    name: N,
    impl: (input: In<N>) => Out<N> | Promise<Out<N>>,
  ) => {
    const def = POSTING_TOOLS[name];
    return async (raw: unknown): Promise<Out<N>> =>
      def.output.parse(await impl(def.input.parse(raw) as In<N>)) as Out<N>;
  };
  const must = (id: string) => {
    const p = repos.postings.get(id);
    if (!p) throw new PostingToolError("posting_not_found", `Vaga não encontrada: ${id}`);
    return p;
  };
  const session = () => (ctx.sessionId ? repos.chatSessions.get(ctx.sessionId) : null);
  const focus = () => session()?.profileId ?? repos.profiles.active()?.id ?? null;

  return {
    "posting.create": wrap("posting.create", async (i) => {
      const r = await ctx.ports.intake(i);
      if (!r.ok) throw new PostingToolError(r.code, r.message);
      const p = r.posting;
      // a conversa da análise passa a apontar para a vaga que ela criou
      const s = session();
      if (s?.category === "job" && !s.postingId) repos.chatSessions.setPosting(s.id, p.id);
      return {
        postingId: p.id,
        ref: postingRef(p.id),
        status: p.status,
        url: postingUrl(p.id),
        title: postingSessionTitle(p),
        preAnalysis: brief(p.preAnalysis as PreAnalysis | null, focus()),
        sameIdentity: p.identityHash
          ? repos.postings
              .findByIdentity(p.identityHash, p.id)
              .map((o) => ({ id: o.id, line: postingLine(o) }))
          : [],
      };
    }),
    "posting.get": wrap("posting.get", (i) => {
      const p = must(i.id);
      const latest = repos.jobAnalyses.latest(p.id);
      const stale = latest ? analysisStale(repos, latest, p) : null;
      const { id: _id, status, fieldSources, preAnalysis, ...rest } = p;
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest))
        if (
          !["identityHash", "rawPath", "duplicate", "createdAt", "updatedAt"].includes(k) &&
          v !== null &&
          !(Array.isArray(v) && v.length === 0)
        )
          fields[k] = v;
      return {
        id: p.id,
        ref: postingRef(p.id),
        status,
        fields,
        fieldSources,
        preAnalysis: brief(preAnalysis as PreAnalysis | null, focus()),
        contacts: repos.postingContacts.list(p.id).map((c) => ({
          id: c.id,
          line: [c.name, c.origin, c.email, c.phone, c.linkedinUrl, c.pinned ? "fixado" : null]
            .filter(Boolean)
            .join(" · "),
        })),
        notes: repos.postingNotes.list(p.id).map((n) => ({
          id: n.id,
          author: n.author,
          body: n.body,
          pending: n.pendingBody !== null,
        })),
        analysis: latest
          ? {
              id: latest.id,
              createdAt: latest.createdAt,
              stale: Boolean(stale?.facts || stale?.posting),
              summary: (latest.analysis as JobAnalysis).summary ?? "",
            }
          : null,
        discarded: discardedPostings(repos, p.id),
        url: postingUrl(p.id),
      };
    }),
    "posting.search": wrap("posting.search", (i) => {
      const hits = searchPostings(repos, i.query ?? "");
      return {
        items: hits
          .slice(0, i.limit ?? 10)
          .map((p) => ({ id: p.id, ref: postingRef(p.id), line: postingLine(p) })),
      };
    }),
    "posting.update": wrap("posting.update", (i) => {
      must(i.id);
      const fields = Object.fromEntries(
        Object.entries(i.fields).filter(([, v]) => v !== undefined),
      ) as Partial<PostingFields>;
      repos.postings.update(i.id, fields, { source: "user" });
      ctx.ports.changed?.(i.id);
      return { id: i.id, updated: Object.keys(fields) };
    }),
    "posting.contact_add": wrap("posting.contact_add", (i) => {
      must(i.postingId);
      const linkedinUrl = i.linkedinUrl ? normalizeLinkedinUrl(i.linkedinUrl) : null;
      if (i.linkedinUrl && !linkedinUrl)
        throw new Error("Link do LinkedIn inválido: use o endereço do perfil (linkedin.com/in/…).");
      // quem indicou: outro contato da vaga, pelo nome (sem acento e caixa) ou pelo id
      const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
      const referrer = i.referredBy
        ? repos.postingContacts
            .list(i.postingId)
            .find((c) => c.id === i.referredBy || norm(c.name) === norm(i.referredBy as string))
        : undefined;
      if (i.referredBy && !referrer)
        throw new Error(
          `Quem indicou (${i.referredBy}) não está nos contatos da vaga: registre essa pessoa antes.`,
        );
      const input = {
        name: i.name,
        origin: i.origin,
        email: i.email ?? null,
        phone: i.phone ?? null,
        linkedinUrl,
        role: i.role ?? null,
        contactedOn: i.contactedOn ?? null,
        summary: i.summary ?? null,
        referredById: referrer?.id ?? null,
      };
      const dup = repos.postingContacts.findDuplicate(i.postingId, input);
      if (dup) return { id: dup.id, duplicate: true };
      const c = repos.postingContacts.add(i.postingId, input);
      ctx.ports.changed?.(i.postingId);
      return { id: c.id };
    }),
    "posting.note_add": wrap("posting.note_add", (i) => {
      must(i.postingId);
      const n = repos.postingNotes.add(i.postingId, "recruiter", i.body);
      ctx.ports.changed?.(i.postingId);
      return { id: n.id };
    }),
    "posting.note_update": wrap("posting.note_update", (i) => {
      if (!repos.postingNotes.get(i.id))
        throw new PostingToolError("note_not_found", `Nota não encontrada: ${i.id}`);
      const r = editPostingNote(repos, i.id, "recruiter", i.body);
      ctx.ports.notified?.(r.notifications);
      ctx.ports.changed?.(r.note.postingId);
      return { id: r.note.id, pending: r.pending };
    }),
    "posting.open_analysis": wrap("posting.open_analysis", async (i) => {
      must(i.postingId);
      // já na conversa da análise: não abre outra (o agente não vê a categoria da conversa)
      const current = session();
      if (current?.category === "job") {
        if (!current.postingId) repos.chatSessions.setPosting(current.id, i.postingId);
        throw new PostingToolError(
          "already_in_analysis",
          "Esta conversa já é a da análise desta vaga: analise aqui mesmo (posting_get, recrutador-especializado, analysis_save).",
        );
      }
      // conversa nova (a mensagem com a vaga é a primeira do usuário): vira a da vaga em vez de abrir outra (2026-10-24)
      if (
        current &&
        repos.chatMessages.list(current.id).filter((m) => m.role === "user").length <= 1
      ) {
        const posting = repos.postings.get(i.postingId);
        const title = posting ? postingSessionTitle(posting) : current.title;
        repos.chatSessions.setCategory(current.id, "job");
        repos.chatSessions.setTitle(current.id, title);
        repos.chatSessions.setPosting(current.id, i.postingId);
        ctx.ports.sessionChanged?.(current.id);
        return {
          sameSession: true,
          title,
          next: "Esta conversa era nova e virou a da análise desta vaga: analise aqui mesmo (posting_get, recrutador-especializado, analysis_save), sem abrir outra.",
        };
      }
      if (!ctx.ports.openAnalysis)
        throw new PostingToolError(
          "not_available",
          "No terminal a análise segue nesta mesma conversa: analise a vaga aqui.",
        );
      const r = await ctx.ports.openAnalysis(i.postingId);
      return { sessionId: r.sessionId, title: r.title, url: `/chat/${r.sessionId}` };
    }),
    "analysis.save": wrap("analysis.save", (i) => {
      const p = must(i.postingId);
      const analysis = JobAnalysisSchema.parse(i.analysis);
      const missing = missingEvidence(repos, analysis);
      if (missing.length > 0)
        throw new PostingToolError(
          "evidence_not_found",
          `Evidência que não existe: ${missing.map((e) => `${e.kind}:${e.id}`).join(", ")}. Use os ids devolvidos pelas tools (evidence_*, fact_search) ou tire o item.`,
        );
      const known = new Set(repos.profiles.list({ includeArchived: true }).map((x) => x.id));
      const unknown = [
        ...analysis.profiles.map((x) => x.profileId),
        analysis.recommendedProfileId,
      ].filter((id) => !known.has(id));
      if (unknown.length > 0)
        throw new PostingToolError(
          "profile_not_found",
          `Perfil inexistente: ${unknown.join(", ")}`,
        );
      if (!analysis.profiles.some((x) => x.profileId === analysis.recommendedProfileId))
        throw new PostingToolError(
          "recommended_not_analyzed",
          "O perfil recomendado precisa estar entre os perfis analisados.",
        );
      const s = session();
      const record = repos.jobAnalyses.add({
        postingId: p.id,
        analysis,
        recommendedProfileId: analysis.recommendedProfileId,
        factsVersion: repos.settings.getFactsVersion(),
        postingUpdatedAt: p.contentUpdatedAt,
        models: s ? [s.model] : [],
        usage: null,
        chatSessionId: s?.id ?? null,
      });
      ctx.ports.changed?.(p.id);
      // a pendência "não concluída" desta conversa, se houver, se resolve
      const resolved = s
        ? repos.notifications
            .resolveSubject("chat_session", s.id, ["posting.analysis_incomplete"])
            .map((notification) => ({ notification, created: false }))
        : [];
      ctx.ports.notified?.([notifyPostingAnalysisDone(repos, p), ...resolved]);
      return { analysisId: record.id, url: postingUrl(p.id) };
    }),
    "analysis.get": wrap("analysis.get", (i) => {
      const p = must(i.postingId);
      const latest = repos.jobAnalyses.latest(p.id);
      if (!latest) return { analysis: null, createdAt: null, stale: null };
      return {
        analysis: JobAnalysisSchema.parse(latest.analysis),
        createdAt: latest.createdAt,
        stale: analysisStale(repos, latest, p),
      };
    }),
  };
}
