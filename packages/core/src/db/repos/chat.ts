import {
  type ChatCategory,
  type ChatMessage,
  ChatMessageSchema,
  type ChatSession,
  ChatSessionSchema,
  type ChatSessionState,
  type FactSearchKind,
  nowUtc,
  type ResearchSource,
  ResearchSourceSchema,
  type TrustedDomain,
  TrustedDomainSchema,
  type TrustTag,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { json, type Row } from "../sql";

/**
 * Repositórios da F04 (§3). As consultas são preparadas **sob demanda**: as tabelas só existem a partir da migration
 * 0004, e os repositórios são criados também sobre bancos antigos (testes de upgrade montam o banco 0003 pelos
 * repositórios de produção antes de migrar).
 */
function lazy(db: Db) {
  const cache = new Map<string, ReturnType<Db["prepare"]>>();
  return (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
}

/* ---------- sessões e mensagens ---------- */

export interface ChatSessionCreate {
  profileId: string;
  category: ChatCategory;
  title: string;
  provider: string;
  model: string;
  ingestionRunId?: string | null;
}

export interface ChatSessionsRepo {
  create(input: ChatSessionCreate): ChatSession;
  get(id: string): ChatSession | null;
  /** Mais recentes primeiro; `profileId` filtra; arquivadas só com `includeArchived`. */
  list(filter?: {
    profileId?: string;
    states?: ChatSessionState[];
    includeArchived?: boolean;
  }): ChatSession[];
  setState(id: string, state: ChatSessionState): void;
  setCategory(id: string, category: ChatCategory): void;
  setModel(id: string, model: string): void;
  setTitle(id: string, title: string): void;
  /** null = o transcript do provider se perdeu; a próxima abertura começa sem `resume` (auditoria B). */
  setProviderSessionId(id: string, providerSessionId: string | null): void;
  setCardHash(id: string, hash: string | null): void;
  /** Soma uso do turno e marca atividade agora. */
  addUsage(
    id: string,
    usage: { inputTokens: number; outputTokens: number; costUsd?: number },
  ): void;
  touch(id: string): void;
  countLive(): number;
  /** Apaga a sessão; mensagens saem em cascata (o uso registrado continua, com `session_id` solto). */
  remove(id: string): void;
}

function mapSession(r: Row): ChatSession {
  return ChatSessionSchema.parse({
    id: r.id,
    profileId: r.profile_id,
    category: r.category,
    title: r.title,
    provider: r.provider,
    providerSessionId: r.provider_session_id ?? null,
    model: r.model,
    state: r.state,
    ingestionRunId: r.ingestion_run_id ?? null,
    cardHash: r.card_hash ?? null,
    tokensIn: Number(r.tokens_in),
    tokensOut: Number(r.tokens_out),
    costUsdEst: Number(r.cost_usd_est),
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
  });
}

export function chatSessionsRepo(db: Db): ChatSessionsRepo {
  const q = lazy(db);
  const set = (col: string, id: string, value: unknown) =>
    q(`update chat_session set ${col} = ? where id = ?`).run(value as never, id);
  const repo: ChatSessionsRepo = {
    create(i) {
      const now = nowUtc();
      const id = newId();
      q(
        `insert into chat_session (id, profile_id, category, title, provider, model, ingestion_run_id, created_at, last_activity_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        i.profileId,
        i.category,
        i.title,
        i.provider,
        i.model,
        i.ingestionRunId ?? null,
        now,
        now,
      );
      return repo.get(id) as ChatSession;
    },
    get(id) {
      const r = q("select * from chat_session where id = ?").get(id) as Row | undefined;
      return r ? mapSession(r) : null;
    },
    list(f = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (f.profileId) {
        where.push("profile_id = ?");
        params.push(f.profileId);
      }
      if (f.states?.length) {
        where.push(`state in (${f.states.map(() => "?").join(", ")})`);
        params.push(...f.states);
      } else if (!f.includeArchived) where.push("state <> 'archived'");
      const sql = `select * from chat_session ${where.length ? `where ${where.join(" and ")}` : ""}
                   order by last_activity_at desc, rowid desc`;
      return (db.prepare(sql).all(...(params as never[])) as Row[]).map(mapSession);
    },
    setState: (id, state) => void set("state", id, state),
    setCategory: (id, category) => void set("category", id, category),
    setModel: (id, model) => void set("model", id, model),
    setTitle: (id, title) => void set("title", id, title),
    setProviderSessionId: (id, psid) => void set("provider_session_id", id, psid),
    setCardHash: (id, hash) => void set("card_hash", id, hash),
    addUsage(id, u) {
      q(
        `update chat_session set tokens_in = tokens_in + ?, tokens_out = tokens_out + ?,
           cost_usd_est = cost_usd_est + ?, last_activity_at = ? where id = ?`,
      ).run(u.inputTokens, u.outputTokens, u.costUsd ?? 0, nowUtc(), id);
    },
    touch: (id) => void set("last_activity_at", id, nowUtc()),
    countLive() {
      return Number(
        (q("select count(*) as n from chat_session where state = 'live'").get() as { n: number }).n,
      );
    },
    remove(id) {
      q("delete from chat_session where id = ?").run(id);
    },
  };
  return repo;
}

export interface ChatMessagesRepo {
  add(input: Omit<ChatMessage, "id" | "createdAt">): ChatMessage;
  /** Em ordem de conversa; `before` pagina para trás (cursor = id da mais antiga já carregada). */
  list(sessionId: string, opts?: { limit?: number; before?: string }): ChatMessage[];
  nextTurnIndex(sessionId: string): number;
}

function mapMessage(r: Row): ChatMessage {
  return ChatMessageSchema.parse({
    id: r.id,
    sessionId: r.session_id,
    turnIndex: Number(r.turn_index),
    role: r.role,
    contentMd: r.content_md,
    toolCalls: json(r.tool_calls_json, []),
    usage: json(r.usage_json, null),
    createdAt: r.created_at,
  });
}

export function chatMessagesRepo(db: Db): ChatMessagesRepo {
  const q = lazy(db);
  return {
    add(i) {
      const m = ChatMessageSchema.parse({ ...i, id: newId(), createdAt: nowUtc() });
      q(
        `insert into chat_message (id, session_id, turn_index, role, content_md, tool_calls_json, usage_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        m.id,
        m.sessionId,
        m.turnIndex,
        m.role,
        m.contentMd,
        JSON.stringify(m.toolCalls),
        m.usage ? JSON.stringify(m.usage) : null,
        m.createdAt,
      );
      return m;
    },
    list(sessionId, o = {}) {
      const limit = o.limit ?? 50;
      const rows = o.before
        ? (q(
            `select * from chat_message where session_id = ? and rowid < (select rowid from chat_message where id = ?)
             order by rowid desc limit ?`,
          ).all(sessionId, o.before, limit) as Row[])
        : (q("select * from chat_message where session_id = ? order by rowid desc limit ?").all(
            sessionId,
            limit,
          ) as Row[]);
      return rows.reverse().map(mapMessage);
    },
    nextTurnIndex(sessionId) {
      const r = q(
        "select coalesce(max(turn_index) + 1, 0) as n from chat_message where session_id = ?",
      ).get(sessionId) as { n: number };
      return Number(r.n);
    },
  };
}

/* ---------- domínios confiáveis e fontes de pesquisa (F04-5) ---------- */

/**
 * `*.gov.br` casa `ibge.gov.br` e `www.dados.gov.br`; `glassdoor.*` casa `glassdoor.com`, `glassdoor.com.br` e
 * `glassdoor.co.uk`, mas não `glassdoor.atacante.com` (auditoria A): depois do nome vem só um sufixo público curto,
 * de 1 ou 2 rótulos de até 3 letras.
 */
export function domainMatches(pattern: string, host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const p = pattern.toLowerCase().replace(/^www\./, "");
  if (p.startsWith("*.")) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  if (p.endsWith(".*")) {
    const prefix = p.slice(0, -1);
    if (!h.startsWith(prefix)) return false;
    const rest = h.slice(prefix.length).split(".");
    return rest.length <= 2 && rest.every((l) => /^[a-z]{2,3}$/.test(l));
  }
  return h === p || h.endsWith(`.${p}`);
}

export interface TrustedDomainsRepo {
  list(): TrustedDomain[];
  add(input: { pattern: string; trustTag: TrustTag }): TrustedDomain;
  setEnabled(id: string, enabled: boolean): void;
  /** Só domínios do usuário (os padrão só podem ser desligados). */
  remove(id: string): void;
  /** Primeira entrada habilitada que casa o host; nulo = fora da lista. */
  match(host: string): TrustedDomain | null;
  /** Reset (testes e2e): apaga os do usuário e religa os padrão. */
  restoreDefaults(): void;
}

function mapDomain(r: Row): TrustedDomain {
  return TrustedDomainSchema.parse({
    id: r.id,
    pattern: r.pattern,
    trustTag: r.trust_tag,
    builtin: Number(r.builtin) === 1,
    enabled: Number(r.enabled) === 1,
    createdAt: r.created_at,
  });
}

export class TrustedDomainError extends Error {
  constructor(
    readonly code: "builtin_domain" | "domain_exists" | "domain_not_found",
    message: string,
  ) {
    super(message);
  }
}

export function trustedDomainsRepo(db: Db): TrustedDomainsRepo {
  const q = lazy(db);
  const repo: TrustedDomainsRepo = {
    list() {
      return (q("select * from trusted_domain order by builtin desc, pattern").all() as Row[]).map(
        mapDomain,
      );
    },
    add(i) {
      const d = TrustedDomainSchema.parse({
        id: newId(),
        pattern: i.pattern.trim().toLowerCase(),
        trustTag: i.trustTag,
        builtin: false,
        enabled: true,
        createdAt: nowUtc(),
      });
      if (q("select 1 from trusted_domain where pattern = ?").get(d.pattern)) {
        throw new TrustedDomainError("domain_exists", `Domínio já cadastrado: ${d.pattern}`);
      }
      q(
        "insert into trusted_domain (id, pattern, trust_tag, builtin, enabled, created_at) values (?, ?, ?, 0, 1, ?)",
      ).run(d.id, d.pattern, d.trustTag, d.createdAt);
      return d;
    },
    setEnabled(id, enabled) {
      q("update trusted_domain set enabled = ? where id = ?").run(enabled ? 1 : 0, id);
    },
    remove(id) {
      const r = q("select builtin from trusted_domain where id = ?").get(id) as Row | undefined;
      if (!r) throw new TrustedDomainError("domain_not_found", "Domínio não encontrado");
      if (Number(r.builtin) === 1) {
        throw new TrustedDomainError("builtin_domain", "Domínios padrão só podem ser desligados");
      }
      q("delete from trusted_domain where id = ?").run(id);
    },
    match(host) {
      return repo.list().find((d) => d.enabled && domainMatches(d.pattern, host)) ?? null;
    },
    restoreDefaults() {
      q("delete from trusted_domain where builtin = 0").run();
      q("update trusted_domain set enabled = 1 where builtin = 1").run();
    },
  };
  return repo;
}

export interface ResearchSourcesRepo {
  add(input: Omit<ResearchSource, "id" | "accessedAt" | "accepted">): ResearchSource;
  get(id: string): ResearchSource | null;
  list(filter?: { profileId?: string; limit?: number }): ResearchSource[];
  setAccepted(id: string, accepted: boolean): void;
}

function mapSource(r: Row): ResearchSource {
  return ResearchSourceSchema.parse({
    id: r.id,
    profileId: r.profile_id ?? null,
    sessionId: r.session_id ?? null,
    url: r.url,
    domain: r.domain,
    title: r.title,
    excerpt: r.excerpt,
    usedFor: r.used_for,
    trustTag: r.trust_tag,
    accepted: r.accepted === null || r.accepted === undefined ? null : Number(r.accepted) === 1,
    accessedAt: r.accessed_at,
  });
}

export function researchSourcesRepo(db: Db): ResearchSourcesRepo {
  const q = lazy(db);
  const repo: ResearchSourcesRepo = {
    add(i) {
      const s = ResearchSourceSchema.parse({
        ...i,
        id: newId(),
        accepted: null,
        accessedAt: nowUtc(),
      });
      q(
        `insert into research_source (id, profile_id, session_id, url, domain, title, excerpt, used_for, trust_tag, accessed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        s.id,
        s.profileId,
        s.sessionId,
        s.url,
        s.domain,
        s.title,
        s.excerpt,
        s.usedFor,
        s.trustTag,
        s.accessedAt,
      );
      return s;
    },
    get(id) {
      const r = q("select * from research_source where id = ?").get(id) as Row | undefined;
      return r ? mapSource(r) : null;
    },
    list(f = {}) {
      const rows = f.profileId
        ? (q(
            "select * from research_source where profile_id = ? order by accessed_at desc, rowid desc limit ?",
          ).all(f.profileId, f.limit ?? 50) as Row[])
        : (q("select * from research_source order by accessed_at desc, rowid desc limit ?").all(
            f.limit ?? 50,
          ) as Row[]);
      return rows.map(mapSource);
    },
    setAccepted(id, accepted) {
      q("update research_source set accepted = ? where id = ?").run(accepted ? 1 : 0, id);
    },
  };
  return repo;
}

/* ---------- busca de fatos (FTS5, F02-2 / F04-12) ---------- */

export interface FactSearchHit {
  kind: FactSearchKind;
  id: string;
  title: string;
  rank: number;
}

export interface FactSearchRepo {
  /**
   * Busca no índice: cada palavra vira prefixo (`termo*`), acentos ignorados; ordenada pelo `bm25` do FTS5.
   * Aspas e operadores digitados pelo usuário são neutralizados.
   */
  search(q: string, opts?: { kinds?: FactSearchKind[]; limit?: number }): FactSearchHit[];
}

/** Converte o texto livre num MATCH seguro: só palavras, cada uma como prefixo entre aspas. */
export function toFtsQuery(text: string): string | null {
  const words = text
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 12);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}

export function factSearchRepo(db: Db): FactSearchRepo {
  return {
    search(text, o = {}) {
      const match = toFtsQuery(text);
      if (!match) return [];
      const params: unknown[] = [match];
      let kinds = "";
      if (o.kinds?.length) {
        kinds = ` and kind in (${o.kinds.map(() => "?").join(", ")})`;
        params.push(...o.kinds);
      }
      params.push(o.limit ?? 20);
      const rows = db
        .prepare(
          `select kind, fact_id, title, bm25(fact_fts) as rank from fact_fts
           where fact_fts match ?${kinds} order by rank limit ?`,
        )
        .all(...(params as never[])) as Row[];
      return rows.map((r) => ({
        kind: r.kind as FactSearchKind,
        id: String(r.fact_id),
        title: String(r.title),
        rank: Number(r.rank),
      }));
    },
  };
}
