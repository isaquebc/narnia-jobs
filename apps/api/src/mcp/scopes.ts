import { CHAT_TOOLS, type ChatCategory, INGEST_TOOLS, PROFILE_TOOLS } from "@narnia-jobs/shared";

/**
 * Escopos de tools por categoria de sessão (F04-2, lazy load real). A sessão vem do header `X-Narnia-Session` (modo
 * A); sem header (modo B, terminal) valem carreira + ingestão, mais `ingest.propose` para a skill `clarificar`.
 */
// `profile.switch` muda o perfil ativo de todo o app: só no terminal (auditoria A); no chat as tools de perfil ficam
// presas ao perfil da sessão (server.ts)
const CHAT_PROFILE = [
  "profile.list",
  "profile.get_card",
  "profile.update_emphasis",
  "profile.update_pitch",
  "profile.create",
];
const CAREER = [
  ...CHAT_PROFILE,
  "evidence.",
  "fact.",
  "research.",
  "file.",
  "job.",
  "session.",
  "usage.log",
];
const INGEST = [
  "ingest.text",
  "ingest.file",
  "ingest.confirm",
  "ingest.github",
  "ingest.status",
  "job.",
  "session.",
];
const CLARIFY = ["ingest.status", "ingest.propose", "file.", "fact.", "session."];
// entrevista de descoberta (auditoria E2, 18a): lê o perfil e as lacunas e manda as respostas para a revisão por
// ingest.text; sem pesquisa, sem editar o perfil
const DISCOVERY = [
  "profile.get_card",
  "evidence.",
  "fact.",
  "file.",
  "ingest.text",
  "ingest.status",
  "ingest.confirm",
  "session.",
];

const BY_CATEGORY: Record<ChatCategory, string[]> = {
  career: [...CAREER, ...INGEST],
  ingest: INGEST,
  clarify: CLARIFY,
  interview: CAREER, // F08 refina
  discovery: DISCOVERY,
  // análise de vaga (F06): carreira inteira; as tools `posting.*` e `analysis.*` entram com elas (M5)
  job: [...CAREER, ...INGEST],
};

const matches = (name: string, prefixes: string[]) =>
  prefixes.some((p) => (p.endsWith(".") ? name.startsWith(p) : name === p));

// `ingest.propose` no terminal: a skill `clarificar` do modo B (auditoria C); o server.ts exige uma execução pronta para
// revisão, já que sem sessão não há execução vinculada
const TERMINAL = [...CAREER, "profile.switch", ...INGEST, "ingest.propose"];

export function inScope(name: string, category: ChatCategory | null): boolean {
  return matches(name, category ? BY_CATEGORY[category] : TERMINAL);
}

/** Tools nativas do CLI por categoria de sessão (F04-2): pesquisa web só onde faz sentido. */
export const NATIVE_TOOLS: Record<ChatCategory, string[]> = {
  career: ["WebSearch", "WebFetch"],
  ingest: [],
  clarify: [],
  interview: [],
  discovery: [],
  job: ["WebSearch", "WebFetch"],
};

const ALL_TOOLS = [
  ...Object.keys(PROFILE_TOOLS),
  ...Object.keys(INGEST_TOOLS),
  ...Object.keys(CHAT_TOOLS),
];

/**
 * A troca de categoria pelo próprio agente (`session.set_category`) só pode estreitar o escopo: toda tool (do `/mcp`
 * e nativa) da categoria nova já precisa estar liberada na atual. Ampliar (ex.: clarificação → carreira) só pela UI.
 */
export function narrowsScope(from: ChatCategory, to: ChatCategory): boolean {
  if (from === to) return true;
  const mcpOk = ALL_TOOLS.every((n) => !inScope(n, to) || inScope(n, from));
  return mcpOk && NATIVE_TOOLS[to].every((n) => NATIVE_TOOLS[from].includes(n));
}

/**
 * Nome publicado (F04-18): a API do Claude só aceita `[a-zA-Z0-9_-]` em nomes de tool, então o servidor publica
 * `profile_get_card` para `profile.get_card`. Os schemas e handlers mantêm o nome com ponto.
 */
export const publishedName = (name: string) => name.replaceAll(".", "_");
