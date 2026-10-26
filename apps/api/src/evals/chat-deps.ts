import type { EvalCase } from "@narnia-jobs/core";

/**
 * Dependências de um caso do chat para o gate pairwise (gate robusto, 2026-10-25): nome do prompt → hash do catálogo.
 * Os agentes e a nota do cartão estão em toda conversa; as outras notas e skills só na conversa que a API abre com elas
 * (`session-manager.ts`) ou quando a conversa chama a tool que as dispara. As tools vêm das duas rodadas comparadas
 * (aprovada e candidata): uma conversa que passou a analisar vaga passa a depender da skill da análise.
 */
const ALWAYS = [
  "narnia-recrutador",
  "narnia-recrutador-especializado",
  "narnia-nota-cartao-via-tool",
];

export function chatCaseDeps(
  c: Pick<EvalCase, "category"> & { open?: EvalCase["open"] },
  tools: string[],
  catalog: Array<{ name: string; hash: string }>,
): Record<string, string> {
  const names = [...ALWAYS];
  if (c.category === "discovery") names.push("narnia-nota-descoberta-contexto");
  if (c.category === "clarify") names.push("narnia-nota-clarificar-contexto");
  if (c.open === "application_chat" || c.open === "application_chat_no_posting")
    names.push("narnia-nota-candidatura-contexto", "narnia-skill-responder-candidatura");
  if (c.open === "document_feedback") names.push("narnia-nota-documento-feedback-contexto");
  if (tools.includes("posting_open_analysis"))
    names.push("narnia-nota-analise-vaga-contexto", "narnia-skill-analisar-vaga");
  // a ingestão pronta volta à conversa que a pediu com a nota `ingestao-pronta`
  if (tools.some((t) => t.startsWith("ingest_"))) names.push("narnia-nota-ingestao-pronta");
  const hashes = new Map(catalog.map((p) => [p.name, p.hash]));
  return Object.fromEntries(names.map((n) => [n, hashes.get(n) ?? "ausente"]));
}
