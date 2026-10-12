import type { ChatCategory } from "@narnia-jobs/shared";

/**
 * Escopos de tools por categoria de sessão (F04-2, lazy load real). A sessão vem do header `X-Narnia-Session` (modo
 * A); sem header (modo B, terminal) valem carreira + ingestão. `ingest.propose` só existe na clarificação.
 */
const CAREER = [
  "profile.",
  "evidence.",
  "fact.",
  "research.",
  "file.",
  "job.",
  "session.",
  "usage.log",
];
const INGEST = ["ingest.text", "ingest.file", "ingest.github", "ingest.status", "job.", "session."];
const CLARIFY = ["ingest.status", "ingest.propose", "file.", "fact.", "session."];

const BY_CATEGORY: Record<ChatCategory, string[]> = {
  career: [...CAREER, ...INGEST],
  ingest: INGEST,
  clarify: CLARIFY,
  interview: CAREER, // F08 refina
};

const matches = (name: string, prefixes: string[]) =>
  prefixes.some((p) => (p.endsWith(".") ? name.startsWith(p) : name === p));

export function inScope(name: string, category: ChatCategory | null): boolean {
  return matches(name, category ? BY_CATEGORY[category] : [...CAREER, ...INGEST]);
}

/**
 * Nome publicado (F04-18): a API do Claude só aceita `[a-zA-Z0-9_-]` em nomes de tool, então o servidor publica
 * `profile_get_card` para `profile.get_card`. Os schemas e handlers mantêm o nome com ponto.
 */
export const publishedName = (name: string) => name.replaceAll(".", "_");
