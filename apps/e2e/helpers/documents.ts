import { api } from "./api";

/** F05 · CV e carta pela API (montar cenário, esperar a geração, conferir o que foi gravado). */
export interface DocView {
  document: {
    id: string;
    kind: string;
    postingId: string | null;
    templateId: string;
    currentVersion: number;
    locale: string;
    format: string;
  };
  current: {
    version: number;
    status: string;
    atsScore: number | null;
    pagesRendered: number | null;
    review: { passed: boolean } | null;
  } | null;
  versions: Array<{ version: number; status: string }>;
  stale: { facts: boolean; profile: boolean; posting: boolean } | null;
}

export const documents = (q: { profileId?: string; postingId?: string }) =>
  api<{ documents: DocView[] }>(
    `/api/documents?${new URLSearchParams(q as Record<string, string>)}`,
  ).then((r) => r.documents);

export const generate = (body: Record<string, unknown>) =>
  api<{ documents: DocView[] }>("/api/documents", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.documents);

const TERMINAL = new Set(["ready", "ready_with_issues", "error"]);

/** Espera todos os documentos do filtro terminarem (gerar → montar → conferir → revisar). */
export async function waitDocuments(
  q: { profileId?: string; postingId?: string },
  count = 1,
  timeoutMs = 60_000,
) {
  const t0 = Date.now();
  for (;;) {
    const docs = await documents(q);
    if (docs.length >= count && docs.every((d) => d.current && TERMINAL.has(d.current.status)))
      return docs;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(
        `documentos não terminaram: ${JSON.stringify(docs.map((d) => d.current?.status))}`,
      );
    await new Promise((r) => setTimeout(r, 500));
  }
}
