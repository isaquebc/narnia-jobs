import { api, BASE_URL, TOKEN } from "./api";

/** F06 · vagas pela API (montar cenário e conferir o que foi gravado). */
export const JD = `Desenvolvedor(a) Backend Sênior
Empresa: Globex Consultoria · Cliente: Initech Bank
São Paulo - SP · Híbrido · CLT

Requisitos:
- 5+ anos com Node.js e TypeScript
- PostgreSQL e Kubernetes
- Docker no dia a dia

Diferenciais:
- AWS e Kafka

Benefícios:
- Vale refeição
- Plano de saúde`;

export interface PostingRow {
  id: string;
  status: string;
  company: string | null;
  client: string | null;
  title: string | null;
  fieldSources: Record<string, string>;
}

export const intake = (body: { text?: string; fields?: Record<string, unknown> }) =>
  api<{ posting: PostingRow }>("/api/postings/intake", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.posting);
export const listPostings = () =>
  api<{ postings: PostingRow[] }>("/api/postings").then((r) => r.postings);
export const getPosting = (id: string) =>
  api<{
    posting: PostingRow;
    notes: Array<{ id: string; body: string; pendingBody: string | null }>;
  }>(`/api/postings/${id}`);
export const addNote = (id: string, body: string) =>
  api<{ note: { id: string } }>(`/api/postings/${id}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  }).then((r) => r.note);
export const analyses = (id: string) =>
  api<{ analyses: Array<{ id: string; stale: { facts: boolean; posting: boolean } }> }>(
    `/api/postings/${id}/analyses`,
  ).then((r) => r.analyses);
export const analyze = (id: string) =>
  api<{ session: { id: string; title: string } }>(`/api/postings/${id}/analyze`, {
    method: "POST",
  }).then((r) => r.session);

/** Chamada de tool no `/mcp` do terminal (modo B): o que o recrutador faria pela conversa. */
export async function mcpCall<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const raw = await res.text();
  const body = JSON.parse(
    raw.startsWith("{") ? raw : (raw.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5),
  ) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const text = body.result?.content?.[0]?.text ?? "";
  if (body.result?.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text) as T;
}
