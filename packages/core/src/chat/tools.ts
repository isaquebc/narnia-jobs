import {
  CHAT_TOOLS,
  type ChatToolName,
  CONTRACT_TYPE_LABELS,
  type Compensation,
  type EmphasisFactKind,
  type FactSearchKind,
  formatCompensation,
  nowUtc,
  type RunStatus,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import { newId } from "../ids";
import {
  FactChangeError,
  type FactChangePlan,
  factChangeOf,
  planFactChange,
} from "../ingest/fact-change";
import { isBelowReference } from "../salary";
import { factRefs, researchRef } from "./citations";
import { aliasKeys, expandQuery } from "./fact-search";
import { resolveChatSettings } from "./settings";

/**
 * Handlers puros das tools novas do servidor MCP (F04 §2.3): validam entrada e saída pelos schemas de
 * `packages/shared/src/mcp/chat.ts`; exposição pelo servidor MCP no M2. Listas devolvem uma linha por item (30–40
 * tokens) ordenadas pela relevância do perfil da sessão (F02-2); detalhe só no `get`.
 */
type In<N extends ChatToolName> = z.infer<(typeof CHAT_TOOLS)[N]["input"]>;
type Out<N extends ChatToolName> = z.infer<(typeof CHAT_TOOLS)[N]["output"]>;
export type ChatToolHandlers = { [N in ChatToolName]: (input: unknown) => Promise<Out<N>> };
export const CHAT_TOOL_NAMES = Object.keys(CHAT_TOOLS) as ChatToolName[];

export type ChatToolErrorCode =
  | "fact_not_found"
  | "file_not_found"
  | "job_not_found"
  | "no_session"
  | "no_profile"
  | "untrusted_domain"
  | "invalid_url"
  | "source_not_found"
  | "source_not_in_profile"
  | "field_not_pending"
  | "invalid_change"
  | "no_change"
  | "quote_not_found";

/** Erro tipado das tools; o servidor MCP (M2) devolve como `isError` com o texto em pt-BR. */
export class ChatToolError extends Error {
  constructor(
    readonly code: ChatToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Resultado de uma ingestão iniciada pela conversa. */
export interface IngestStart {
  runId: string;
  status: RunStatus;
  estimatedTokens: number;
  needsConfirmation: boolean;
}

/**
 * Porta da ingestão pela conversa (F04-16): criar a execução exige fila, provider (orçamento do GitHub) e o
 * armazenamento de arquivos, que vivem no `api`. O `api` implementa esta porta com as **mesmas funções** que as rotas
 * de ingestão usam, para a conversa e a tela seguirem o mesmo caminho (orçamento, confirmação, conferência).
 */
export interface ChatIngestPort {
  startText(text: string): Promise<IngestStart & { alreadyRead: boolean }>;
  startFile(fileId: string): Promise<IngestStart & { alreadyRead: boolean }>;
  startGithub(req: In<"ingest.github">): Promise<IngestStart>;
  /** Confirma a estimativa de uma execução de texto/arquivo criada por esta conversa (auditoria E1). */
  confirm(runId: string): Promise<{ runId: string; status: RunStatus }>;
  /** Grava o registro da alteração como fonte e cria a execução em revisão (`createFactChangeRun`). */
  proposeChange(plan: FactChangePlan): Promise<{ runId: string; status: RunStatus }>;
}

export interface ChatToolsContext {
  ingest: ChatIngestPort;
  /** Sessão do chat (modo A, header da sessão); ausente no modo B (terminal). */
  sessionId?: string | null;
}

const runUrl = (runId: string) => `/ingestao/${runId}`;

/* ---------- períodos (datas parciais YYYY, YYYY-MM, YYYY-MM-DD) ---------- */

function bound(date: string, end: boolean): string {
  const [y, m] = date.split("-");
  return `${y}-${m ?? (end ? "12" : "01")}`;
}
function period(start?: string | null, end?: string | null, current?: boolean): string | null {
  if (!start) return null;
  return `${start}–${end ?? (current ? "atual" : start)}`;
}
function overlaps(
  f: { start?: string | null; end?: string | null; current?: boolean },
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;
  if (!f.start) return false;
  const s = bound(f.start, false);
  const e = f.end ? bound(f.end, true) : f.current ? "9999-12" : bound(f.start, true);
  if (to && s > bound(to, true)) return false;
  if (from && e < bound(from, false)) return false;
  return true;
}

/** Arquivo e repositório não são fatos citáveis (`f:`): só os seis tipos do registro. */
const isFactKind = (kind: FactSearchKind) => kind !== "file" && kind !== "repo";

const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function createChatTools(repos: Repos, ctx: ChatToolsContext): ChatToolHandlers {
  const wrap = <N extends ChatToolName>(
    name: N,
    impl: (input: In<N>) => Out<N> | Promise<Out<N>>,
  ) => {
    const def = CHAT_TOOLS[name];
    return async (raw: unknown): Promise<Out<N>> =>
      def.output.parse(await impl(def.input.parse(raw) as In<N>)) as Out<N>;
  };

  const session = () => (ctx.sessionId ? repos.chatSessions.get(ctx.sessionId) : null);
  /** Perfil da sessão (modo A) ou o ativo (modo B). */
  const profileId = (): string | null =>
    session()?.profileId ?? repos.profiles.active()?.id ?? null;

  const relevance = () => {
    const pid = profileId();
    const map = new Map<string, number>();
    if (!pid) return map;
    for (const r of repos.relevance.listByProfile(pid))
      map.set(`${r.factKind}:${r.factId}`, r.score);
    return map;
  };

  const page = <T extends { id: string; line: string; relevance: number | null }>(
    items: T[],
    input: { limit?: number | undefined; cursor?: string | undefined },
    refOf?: (id: string) => string,
  ) => {
    const offset = Number(input.cursor ?? 0) || 0;
    const limit = input.limit ?? 20;
    const slice = items.slice(offset, offset + limit);
    return {
      items: slice.map(({ id, line, relevance: rel }) => ({
        id,
        ...(refOf ? { ref: refOf(id) } : {}),
        line: clip(line),
        relevance: rel,
      })),
      nextCursor: offset + limit < items.length ? String(offset + limit) : null,
    };
  };

  const byRelevance = <T extends { relevance: number | null; date?: string | null }>(items: T[]) =>
    items.sort(
      (a, b) =>
        (b.relevance ?? -1) - (a.relevance ?? -1) || (b.date ?? "").localeCompare(a.date ?? ""),
    );

  /* ---------- linhas e detalhes por tipo ---------- */

  const experienceLine = (e: {
    company: string;
    title: string;
    startDate: string;
    endDate?: string | null | undefined;
    isCurrent: boolean;
    employmentType?: keyof typeof CONTRACT_TYPE_LABELS | undefined;
    weeklyHours?: number | undefined;
    compensation?: Compensation | undefined;
  }) =>
    [
      `${e.company} · ${e.title} · ${period(e.startDate, e.endDate, e.isCurrent)}`,
      [
        e.employmentType ? CONTRACT_TYPE_LABELS[e.employmentType] : null,
        e.weeklyHours ? `${e.weeklyHours} h/semana` : null,
      ]
        .filter(Boolean)
        .join(", "),
      e.compensation ? formatCompensation(e.compensation, e.weeklyHours) : "",
    ]
      .filter(Boolean)
      .join(" · ");

  function describe(
    kind: FactSearchKind,
    id: string,
  ): { line: string; start: string | null; end: string | null; current: boolean } | null {
    switch (kind) {
      case "experience": {
        const e = repos.facts.experiences.get(id);
        return e
          ? {
              line: experienceLine(e),
              start: e.startDate,
              end: e.endDate ?? null,
              current: e.isCurrent,
            }
          : null;
      }
      case "achievement": {
        const a = repos.facts.achievements.get(id);
        if (!a) return null;
        const e = repos.facts.experiences.get(a.experienceId);
        return {
          line: `${a.text}${a.metric ? ` (${a.metric})` : ""}${e ? ` · ${e.company}` : ""}`,
          start: e?.startDate ?? null,
          end: e?.endDate ?? null,
          current: e?.isCurrent ?? false,
        };
      }
      case "project": {
        const p = repos.facts.projects.get(id);
        return p
          ? {
              line: `${p.name}${p.role ? ` · ${p.role}` : ""}${p.startDate ? ` · ${period(p.startDate, p.endDate)}` : ""}`,
              start: p.startDate ?? null,
              end: p.endDate ?? null,
              current: false,
            }
          : null;
      }
      case "skill": {
        const s = repos.facts.skills.get(id);
        return s
          ? {
              line: `${s.name} · ${s.category}${s.level ? ` · nível ${s.level}` : ""}`,
              start: null,
              end: null,
              current: false,
            }
          : null;
      }
      case "education": {
        const e = repos.facts.education.get(id);
        return e
          ? {
              line: `${e.institution} · ${e.course}${e.startDate ? ` · ${period(e.startDate, e.endDate)}` : ""}`,
              start: e.startDate ?? null,
              end: e.endDate ?? null,
              current: e.status === "in_progress",
            }
          : null;
      }
      case "language": {
        const l = repos.facts.languages.get(id);
        return l
          ? { line: `${l.name} · ${l.level}`, start: null, end: null, current: false }
          : null;
      }
      case "file": {
        const f = repos.sourceFiles.get(id);
        const d = repos.digests.get(id);
        return f
          ? {
              line: `${f.originalName ?? "Texto livre"}${d ? ` · ${d.summary}` : ""}`,
              start: null,
              end: null,
              current: false,
            }
          : null;
      }
      case "repo": {
        const r = repos.repos.get(id);
        const d = repos.repoDigests.get(id);
        return r
          ? {
              line: `${r.fullName}${d ? ` · ${d.summary}` : ""}`,
              start: null,
              end: null,
              current: false,
            }
          : null;
      }
    }
  }

  function detail(kind: FactSearchKind, id: string): Record<string, unknown> {
    const notFound = () =>
      new ChatToolError("fact_not_found", `Fato não encontrado: ${kind} ${id}`);
    switch (kind) {
      case "experience": {
        const e = repos.facts.experiences.get(id);
        if (!e) throw notFound();
        const refOf = factRefs(repos);
        return {
          ...e,
          achievements: repos.facts.achievements
            .listByExperience(id)
            .map((a) => ({ ...a, ref: refOf(a.id) })),
        };
      }
      case "achievement":
        return { ...(repos.facts.achievements.get(id) ?? throwIt(notFound())) };
      case "project":
        return { ...(repos.facts.projects.get(id) ?? throwIt(notFound())) };
      case "skill":
        return { ...(repos.facts.skills.get(id) ?? throwIt(notFound())) };
      case "education":
        return { ...(repos.facts.education.get(id) ?? throwIt(notFound())) };
      case "language":
        return { ...(repos.facts.languages.get(id) ?? throwIt(notFound())) };
      case "file": {
        const f = repos.sourceFiles.get(id) ?? throwIt(notFound());
        const d = repos.digests.get(id);
        return { file: f, digest: d ? { summary: d.summary, keyPoints: d.keyPoints } : null };
      }
      case "repo": {
        const r = repos.repos.get(id) ?? throwIt(notFound());
        const d = repos.repoDigests.get(id);
        return { repo: r, digest: d ? { summary: d.summary, keyPoints: d.keyPoints } : null };
      }
    }
  }

  const evidenceList = <K extends EmphasisFactKind>(
    kind: K,
    rows: Array<{ id: string; date?: string | null }>,
  ) => {
    const rel = relevance();
    return byRelevance(
      rows.map((r) => ({
        id: r.id,
        line: describe(kind, r.id)?.line ?? r.id,
        relevance: rel.get(`${kind}:${r.id}`) ?? null,
        date: r.date ?? null,
      })),
    );
  };

  const factRepo = (kind: Exclude<FactSearchKind, "file" | "repo">) =>
    ({
      experience: repos.facts.experiences,
      achievement: repos.facts.achievements,
      project: repos.facts.projects,
      skill: repos.facts.skills,
      education: repos.facts.education,
      language: repos.facts.languages,
    })[kind];

  /* ---------- pesquisa ---------- */

  function normalizeUrl(raw: string): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ChatToolError("invalid_url", `URL inválida: ${raw}`);
    }
    // só páginas web (auditoria A): `javascript:`, `file:` e afins viravam fonte "oficial" e link na tela
    if (u.protocol !== "http:" && u.protocol !== "https:")
      throw new ChatToolError("invalid_url", `Só endereços http ou https: ${raw}`);
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^utm_|^(fbclid|gclid|mc_eid)$/i.test(key)) u.searchParams.delete(key);
    return u;
  }

  return {
    "evidence.experience.list": wrap("evidence.experience.list", (input) =>
      page(
        evidenceList(
          "experience",
          repos.facts.experiences.list().map((e) => ({ id: e.id, date: e.startDate })),
        ),
        input,
        factRefs(repos),
      ),
    ),
    "evidence.experience.get": wrap("evidence.experience.get", (input) => ({
      id: input.id,
      ref: factRefs(repos)(input.id),
      kind: "experience",
      detail: detail("experience", input.id),
    })),
    "evidence.project.list": wrap("evidence.project.list", (input) =>
      page(
        evidenceList(
          "project",
          repos.facts.projects.list().map((p) => ({ id: p.id, date: p.startDate ?? null })),
        ),
        input,
        factRefs(repos),
      ),
    ),
    "evidence.project.get": wrap("evidence.project.get", (input) => ({
      id: input.id,
      ref: factRefs(repos)(input.id),
      kind: "project",
      detail: detail("project", input.id),
    })),
    "evidence.skill.list": wrap("evidence.skill.list", (input) =>
      page(
        evidenceList(
          "skill",
          repos.facts.skills.list().map((s) => ({ id: s.id })),
        ),
        input,
        factRefs(repos),
      ),
    ),
    "evidence.skill.get": wrap("evidence.skill.get", (input) => ({
      id: input.id,
      ref: factRefs(repos)(input.id),
      kind: "skill",
      detail: detail("skill", input.id),
    })),
    "evidence.education.list": wrap("evidence.education.list", (input) =>
      page(
        evidenceList(
          "education",
          repos.facts.education.list().map((e) => ({ id: e.id, date: e.startDate ?? null })),
        ),
        input,
        factRefs(repos),
      ),
    ),
    "evidence.education.get": wrap("evidence.education.get", (input) => ({
      id: input.id,
      ref: factRefs(repos)(input.id),
      kind: "education",
      detail: detail("education", input.id),
    })),

    "fact.search": wrap("fact.search", (input) => {
      const rel = relevance();
      const queries = [...(input.q ? [input.q] : []), ...(input.queries ?? [])];
      // por consulta: termos com OU (expandidos pelo dicionário) e os apelidos aprendidos; o item guarda a melhor
      // posição e as consultas que o acharam (R1, 2026-10-29)
      const found = new Map<
        string,
        { kind: FactSearchKind; id: string; best: number; matched: string[] }
      >();
      for (const q of queries) {
        const hits = [
          ...repos.factAliases
            .lookup(aliasKeys(q))
            .map((a) => ({ kind: a.kind, id: a.factId, rank: Number.NEGATIVE_INFINITY })),
          ...repos.factSearch.searchAny(expandQuery(q), {
            ...(input.kinds ? { kinds: input.kinds } : {}),
            limit: 200,
          }),
        ].filter((h) => !input.kinds || input.kinds.includes(h.kind));
        hits.forEach((h, i) => {
          const key = `${h.kind}:${h.id}`;
          const cur = found.get(key);
          if (cur) {
            cur.best = Math.min(cur.best, i);
            if (!cur.matched.includes(q)) cur.matched.push(q);
          } else found.set(key, { kind: h.kind, id: h.id, best: i, matched: [q] });
        });
      }
      const refOf = factRefs(repos);
      const items = [...found.values()]
        .map((h) => {
          const d = describe(h.kind, h.id);
          if (
            !d ||
            !overlaps({ start: d.start, end: d.end, current: d.current }, input.from, input.to)
          )
            return null;
          return {
            kind: h.kind,
            id: h.id,
            ...(isFactKind(h.kind) ? { ref: refOf(h.id) } : {}),
            line: clip(d.line),
            period: period(d.start, d.end, d.current),
            relevance: rel.get(`${h.kind}:${h.id}`) ?? null,
            matched: h.matched,
            order: h.best,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        // quem bate em mais consultas, depois a posição na busca (bm25: quem bate mais termos), depois o perfil
        .sort(
          (a, b) =>
            b.matched.length - a.matched.length ||
            a.order - b.order ||
            (b.relevance ?? -1) - (a.relevance ?? -1),
        );
      return {
        items: items
          .slice(0, input.limit ?? (queries.length > 1 ? 20 : 10))
          .map(({ order: _o, ...rest }) => rest),
        total: items.length,
      };
    }),
    "fact.alias_add": wrap("fact.alias_add", (input) => {
      if (!describe(input.kind, input.id))
        throw new ChatToolError("fact_not_found", `Fato não encontrado: ${input.kind} ${input.id}`);
      const a = repos.factAliases.add({
        term: input.term,
        kind: input.kind,
        factId: input.id,
        sessionId: ctx.sessionId ?? null,
      });
      return { id: a.id, term: a.term, kind: a.kind, factId: a.factId };
    }),
    "fact.get": wrap("fact.get", (input) => ({
      items: input.refs.map((r) => ({
        id: r.id,
        ...(isFactKind(r.kind) ? { ref: factRefs(repos)(r.id) } : {}),
        kind: r.kind,
        detail: detail(r.kind, r.id),
      })),
    })),
    "fact.timeline": wrap("fact.timeline", (input) => {
      const rows = [
        ...repos.facts.experiences.list().map((e) => ({ kind: "experience" as const, id: e.id })),
        ...repos.facts.projects.list().map((p) => ({ kind: "project" as const, id: p.id })),
        ...repos.facts.education.list().map((e) => ({ kind: "education" as const, id: e.id })),
      ];
      const items = rows
        .map((r) => ({ ...r, d: describe(r.kind, r.id) }))
        .filter(
          (r) =>
            r.d &&
            overlaps(
              { start: r.d.start, end: r.d.end, current: r.d.current },
              input.from,
              input.to ?? input.from,
            ),
        )
        .map((r) => ({
          kind: r.kind,
          id: r.id,
          line: clip(r.d?.line ?? ""),
          start: r.d?.start ?? null,
          end: r.d?.current ? null : (r.d?.end ?? null),
        }))
        .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
      return { items };
    }),
    // auditoria E2 (18a): o que a extração não preencheu; a entrevista de descoberta pergunta só isso (02 §F1, passo 7)
    "fact.gaps": wrap("fact.gaps", (input) => {
      type Gap = {
        kind: "experience" | "achievement" | "project" | "skill" | "education" | "profile";
        id: string;
        line: string;
        missing: string[];
      };
      const gaps: Gap[] = [];
      const push = (
        kind: Gap["kind"],
        id: string,
        line: string,
        missing: Array<string | false>,
      ) => {
        const m = missing.filter((x): x is string => Boolean(x));
        if (m.length > 0) gaps.push({ kind, id, line: clip(line), missing: m });
      };
      const pid = profileId();
      const profile = pid ? repos.profiles.get(pid) : null;
      if (profile) push("profile", profile.id, profile.name, [...profile.needsResearch]);
      for (const e of repos.facts.experiences.list())
        push("experience", e.id, experienceLine(e), [
          !e.isCurrent && !e.endDate && "data de fim",
          !e.summary && "resumo",
          repos.facts.achievements.listByExperience(e.id).length === 0 && "conquistas",
        ]);
      for (const a of repos.facts.achievements.list())
        push("achievement", a.id, describe("achievement", a.id)?.line ?? a.text, [
          !a.metric && "métrica",
        ]);
      for (const ed of repos.facts.education.list())
        push("education", ed.id, describe("education", ed.id)?.line ?? ed.course, [
          !ed.startDate && !ed.endDate
            ? "datas"
            : ed.status === "completed" && !ed.endDate && "data de fim",
        ]);
      for (const s of repos.facts.skills.list())
        push("skill", s.id, describe("skill", s.id)?.line ?? s.name, [!s.level && "nível"]);
      for (const p of repos.facts.projects.list())
        push("project", p.id, describe("project", p.id)?.line ?? p.name, [
          !p.description && "descrição",
          !p.role && "papel",
        ]);
      const offset = Number(input.cursor ?? 0) || 0;
      const limit = input.limit ?? 20;
      return {
        items: gaps.slice(offset, offset + limit),
        nextCursor: offset + limit < gaps.length ? String(offset + limit) : null,
      };
    }),
    "fact.unverified": wrap("fact.unverified", (input) => {
      const kinds: Array<Exclude<FactSearchKind, "file" | "repo">> = [
        "experience",
        "achievement",
        "project",
        "skill",
        "education",
        "language",
      ];
      const items = kinds.flatMap((kind) =>
        (factRepo(kind).list() as Array<{ id: string; verified: boolean }>)
          .filter((f) => !f.verified)
          .map((f) => ({
            kind,
            id: f.id,
            line: clip(describe(kind, f.id)?.line ?? f.id),
            relevance: null,
          })),
      );
      const p = page(items, input);
      const byId = new Map(items.map((i) => [i.id, i.kind]));
      return {
        items: p.items.map((i) => ({
          kind: byId.get(i.id) as FactSearchKind,
          id: i.id,
          line: i.line,
        })),
        nextCursor: p.nextCursor,
      };
    }),
    "fact.propose_change": wrap("fact.propose_change", async (input) => {
      const sessionId = ctx.sessionId ?? null;
      let plan: FactChangePlan;
      try {
        plan = planFactChange(repos, input, { sessionId });
      } catch (e) {
        if (e instanceof FactChangeError) throw new ChatToolError(e.code, e.message);
        throw e;
      }
      // a mesma alteração do mesmo fato ainda esperando o usuário: devolve a pendente em vez de repetir
      const pending = repos.ingestionRuns.list({ status: ["review"] }).find((r) => {
        const c = factChangeOf(r);
        return (
          c?.factId === plan.change.factId &&
          JSON.stringify(c.changes) === JSON.stringify(plan.change.changes)
        );
      });
      if (pending)
        return {
          runId: pending.id,
          status: pending.status,
          url: runUrl(pending.id),
          alreadyPending: true,
        };
      const r = await ctx.ingest.proposeChange(plan);
      return { ...r, url: runUrl(r.runId), alreadyPending: false };
    }),
    "fact.verify": wrap("fact.verify", (input) => {
      const repo = factRepo(input.kind) as {
        get(id: string): unknown;
        update(id: string, patch: { verified: boolean }): unknown;
      };
      if (!repo.get(input.id))
        throw new ChatToolError("fact_not_found", `Fato não encontrado: ${input.kind} ${input.id}`);
      repo.update(input.id, { verified: true });
      return { ok: true as const };
    }),

    "research.save": wrap("research.save", (input) => {
      const url = normalizeUrl(input.url);
      const domain = url.hostname.replace(/^www\./, "");
      const match = repos.trustedDomains.match(url.hostname);
      // fora da lista só com a confirmação do usuário (F04-5), que fica registrada na fonte (auditoria E1)
      const userConfirmed = !match && input.userConfirmed === true;
      if (!match && !userConfirmed && resolveChatSettings(repos.settings).requireTrustedResearch) {
        throw new ChatToolError(
          "untrusted_domain",
          `${domain} não está na lista de fontes confiáveis; pergunte ao usuário se pode usar esta fonte (se ele concordar, chame de novo com userConfirmed: true) ou peça para cadastrar o domínio em Configurações › Chat`,
        );
      }
      const saved = repos.researchSources.add({
        profileId: profileId(),
        // só uma sessão que existe (id órfão quebraria a chave estrangeira)
        sessionId: session()?.id ?? null,
        url: url.toString(),
        domain,
        title: input.title,
        excerpt: input.excerpt,
        usedFor: input.usedFor,
        trustTag: match?.trustTag ?? "other",
        userConfirmed,
      });
      return {
        id: saved.id,
        ref: researchRef(saved.id),
        domain: saved.domain,
        trustTag: saved.trustTag,
      };
    }),
    "research.apply": wrap("research.apply", (input) => {
      const pid = profileId();
      if (!pid) throw new ChatToolError("no_profile", "Nenhum perfil ativo");
      const profile = repos.profiles.get(pid);
      if (!profile) throw new ChatToolError("no_profile", "Perfil não encontrado");
      const source = repos.researchSources.get(input.sourceId);
      if (!source)
        throw new ChatToolError("source_not_found", `Fonte não encontrada: ${input.sourceId}`);
      if (source.profileId !== pid)
        throw new ChatToolError(
          "source_not_in_profile",
          "A fonte não foi pesquisada para este perfil; registre a fonte com research_save nesta conversa.",
        );
      if (!profile.needsResearch.includes(input.field))
        throw new ChatToolError(
          "field_not_pending",
          `${input.field} não está pendente de pesquisa neste perfil; para mudar um dado já preenchido, o usuário edita o perfil.`,
        );
      const patch: Record<string, unknown> = {
        [input.field]: input[input.field],
        needsResearch: profile.needsResearch.filter((f) => f !== input.field),
      };
      if (input.field === "salary" && input.salary) {
        const country = repos.users.get()?.country ?? "BR";
        patch.salaryBelowReference =
          isBelowReference(
            input.salary.min,
            input.salary.currency,
            input.salary.period,
            repos.salaryReferences.current(country),
          ) === true;
      }
      repos.profiles.update(pid, patch as Parameters<Repos["profiles"]["update"]>[1]);
      // o valor veio desta pesquisa (`source.kind = pesquisa`, §3): a fonte fica marcada como aceita
      repos.researchSources.setAccepted(source.id, true);
      return { ok: true as const, field: input.field, profileId: pid };
    }),
    "research.list": wrap("research.list", (input) => {
      const pid = profileId();
      const rows = repos.researchSources.list({ ...(pid ? { profileId: pid } : {}), limit: 200 });
      return page(
        rows.map((r) => ({
          id: r.id,
          line: `${r.title} · ${r.domain} · ${r.usedFor}`,
          relevance: null,
        })),
        input,
        researchRef,
      );
    }),

    "job.status": wrap("job.status", (input) => {
      const j = repos.jobs.get(input.jobId);
      if (!j) throw new ChatToolError("job_not_found", `Job não encontrado: ${input.jobId}`);
      return {
        id: j.id,
        type: j.type,
        status: j.status,
        stage: j.stage,
        progress: j.progress,
        error: j.error,
      };
    }),
    "job.list": wrap("job.list", (input) =>
      page(
        repos.jobs.list({ limit: 200 }).map((j) => ({
          id: j.id,
          line: `${j.type} · ${j.status} · ${Math.round(j.progress)}%`,
          relevance: null,
        })),
        input,
      ),
    ),

    "session.get": wrap("session.get", () => {
      const s = session();
      if (!s) throw new ChatToolError("no_session", "Sem sessão de chat (modo terminal)");
      return {
        id: s.id,
        profileId: s.profileId,
        category: s.category,
        model: s.model,
        state: s.state,
        ingestionRunId: s.ingestionRunId,
      };
    }),
    "session.set_category": wrap("session.set_category", (input) => {
      const s = session();
      if (!s) throw new ChatToolError("no_session", "Sem sessão de chat (modo terminal)");
      repos.chatSessions.setCategory(s.id, input.category);
      return { ok: true as const };
    }),

    "usage.log": wrap("usage.log", (input) => ({
      recorded: repos.usageEvents.insertTurn(
        {
          id: newId(),
          ts: nowUtc(),
          origin: "claude-log",
          category: "chat",
          jobId: null,
          // só uma sessão que existe (id órfão quebraria a chave estrangeira)
          sessionId: session()?.id ?? null,
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cacheRead: input.cacheRead ?? 0,
          cacheWrite: input.cacheWrite ?? 0,
          costUsdEst: input.costUsd ?? 0,
        },
        { providerSessionId: input.providerSessionId, turnIndex: input.turnIndex },
      ),
    })),

    "ingest.text": wrap("ingest.text", async (input) => {
      const r = await ctx.ingest.startText(input.text);
      return { ...r, url: runUrl(r.runId) };
    }),
    "ingest.file": wrap("ingest.file", async (input) => {
      if (!repos.sourceFiles.get(input.fileId)) {
        throw new ChatToolError("file_not_found", `Arquivo não encontrado: ${input.fileId}`);
      }
      const r = await ctx.ingest.startFile(input.fileId);
      return { ...r, url: runUrl(r.runId) };
    }),
    "ingest.confirm": wrap("ingest.confirm", (input) => ctx.ingest.confirm(input.runId)),
    "ingest.github": wrap("ingest.github", async (input) => {
      const r = await ctx.ingest.startGithub(input);
      // F03-13: o GitHub sempre espera o usuário confirmar o orçamento na tela da execução
      return { ...r, needsConfirmation: true, url: runUrl(r.runId) };
    }),
  };
}

function throwIt(e: Error): never {
  throw e;
}
