import { createHash } from "node:crypto";
import type { FactSearchKind } from "@narnia-jobs/shared";
import { type Repos, withTransaction } from "../db";
import type { Embedder } from "./embedder";

/**
 * Busca por sentido (F04-fix-fundamentacao, R6, FF-5): o vetor de cada fato vem do mesmo texto que a busca por termos
 * indexa (`fact_fts`: título e corpo), e a busca compara a pergunta com todos por força bruta (milissegundos até
 * milhares de fatos, sem extensão nativa). Os vetores faltantes ou velhos são refeitos antes de cada busca: o fato que
 * o worker grava entra sem fila própria.
 */
export interface SemanticHit {
  kind: FactSearchKind;
  id: string;
  score: number;
}

export interface SemanticSearchPort {
  search(q: string, o?: { kinds?: FactSearchKind[]; limit?: number }): Promise<SemanticHit[]>;
}

interface Doc {
  kind: FactSearchKind;
  id: string;
  text: string;
  hash: string;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

function docs(repos: Repos): Doc[] {
  const rows = repos.db.prepare("select kind, fact_id, title, body from fact_fts").all() as Array<{
    kind: string;
    fact_id: string;
    title: string | null;
    body: string | null;
  }>;
  return rows.map((r) => {
    const text = [r.title, r.body].filter(Boolean).join(". ");
    return { kind: r.kind as FactSearchKind, id: String(r.fact_id), text, hash: hashOf(text) };
  });
}

const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);

/** Deixa os vetores do modelo iguais ao índice: cria os que faltam, refaz os de texto mudado, apaga os órfãos. */
export async function syncFactVectors(
  repos: Repos,
  embedder: Embedder,
): Promise<{ added: number; updated: number; removed: number }> {
  const db = repos.db;
  const current = docs(repos);
  const stored = new Map(
    (
      db
        .prepare("select kind, fact_id, text_hash from fact_vector where model = ?")
        .all(embedder.model) as Array<{ kind: string; fact_id: string; text_hash: string }>
    ).map((r) => [`${r.kind}:${r.fact_id}`, r.text_hash]),
  );
  const todo = current.filter((d) => stored.get(`${d.kind}:${d.id}`) !== d.hash);
  const updated = todo.filter((d) => stored.has(`${d.kind}:${d.id}`)).length;
  const keep = new Set(current.map((d) => `${d.kind}:${d.id}`));
  const orphans = [...stored.keys()].filter((k) => !keep.has(k));
  const vectors = todo.length
    ? await embedder.embed(
        todo.map((d) => d.text),
        "passage",
      )
    : [];
  const upsert = db.prepare(
    `insert into fact_vector (kind, fact_id, model, text_hash, vec) values (?, ?, ?, ?, ?)
       on conflict (kind, fact_id, model) do update set text_hash = excluded.text_hash, vec = excluded.vec`,
  );
  const del = db.prepare("delete from fact_vector where kind = ? and fact_id = ? and model = ?");
  withTransaction(db, () => {
    todo.forEach((d, i) => {
      const v = vectors[i];
      if (v) upsert.run(d.kind, d.id, embedder.model, d.hash, toBlob(v));
    });
    for (const k of orphans) {
      const at = k.indexOf(":");
      del.run(k.slice(0, at), k.slice(at + 1), embedder.model);
    }
    // vetores de outros modelos não servem mais
    db.prepare("delete from fact_vector where model <> ?").run(embedder.model);
  });
  return { added: todo.length - updated, updated, removed: orphans.length };
}

export function createSemanticSearch(repos: Repos, embedder: Embedder): SemanticSearchPort {
  return {
    async search(q, o = {}) {
      await syncFactVectors(repos, embedder);
      const [query] = await embedder.embed([q], "query");
      if (!query) return [];
      const rows = repos.db
        .prepare("select kind, fact_id, vec from fact_vector where model = ?")
        .all(embedder.model) as Array<{ kind: string; fact_id: string; vec: Uint8Array }>;
      return rows
        .filter((r) => !o.kinds?.length || o.kinds.includes(r.kind as FactSearchKind))
        .map((r) => {
          const v = fromBlob(r.vec);
          let s = 0;
          for (let i = 0; i < v.length; i++) s += (v[i] as number) * ((query[i] as number) ?? 0);
          return { kind: r.kind as FactSearchKind, id: String(r.fact_id), score: s };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, o.limit ?? 10);
    },
  };
}
