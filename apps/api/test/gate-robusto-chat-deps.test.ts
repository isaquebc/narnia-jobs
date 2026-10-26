import { describe, expect, it } from "vitest";
import { chatCaseDeps } from "../src/evals/chat-deps";
import { promptCatalog } from "../src/evals/prompt-catalog";

/**
 * Gate robusto (2026-10-25) · dependências de um caso do chat: os agentes e a nota do cartão valem para todos; as
 * outras notas e as skills só entram na conversa que a API abre com elas (session-manager) ou quando a conversa chama
 * a tool que as dispara. Mudar a skill do formulário não põe a conversa de salário no pairwise.
 */
const catalog = promptCatalog();
const hash = (name: string) => catalog.find((p) => p.name === name)?.hash;
const BASE = [
  "narnia-nota-cartao-via-tool",
  "narnia-recrutador",
  "narnia-recrutador-especializado",
];

describe("gate robusto · dependências por caso do chat", () => {
  it("conversa comum: só os agentes e o cartão, com os hashes do catálogo", () => {
    const deps = chatCaseDeps({ category: "career" }, ["WebSearch", "research_save"], catalog);
    expect(Object.keys(deps).sort()).toEqual(BASE);
    expect(deps["narnia-recrutador"]).toBe(hash("narnia-recrutador"));
  });

  it("conversa do formulário: nota e skill do formulário", () => {
    for (const open of ["application_chat", "application_chat_no_posting"] as const)
      expect(Object.keys(chatCaseDeps({ category: "job", open }, [], catalog)).sort()).toEqual(
        [...BASE, "narnia-nota-candidatura-contexto", "narnia-skill-responder-candidatura"].sort(),
      );
  });

  it("feedback do documento, análise de vaga, ingestão, descoberta e clarificação", () => {
    const keys = (c: Parameters<typeof chatCaseDeps>[0], tools: string[] = []) =>
      Object.keys(chatCaseDeps(c, tools, catalog)).filter((k) => !BASE.includes(k));
    expect(keys({ category: "job", open: "document_feedback" })).toEqual([
      "narnia-nota-documento-feedback-contexto",
    ]);
    expect(
      keys({ category: "career" }, ["posting_create", "posting_open_analysis"]).sort(),
    ).toEqual(["narnia-nota-analise-vaga-contexto", "narnia-skill-analisar-vaga"]);
    expect(keys({ category: "career" }, ["ingest_text"])).toEqual(["narnia-nota-ingestao-pronta"]);
    expect(keys({ category: "discovery" })).toEqual(["narnia-nota-descoberta-contexto"]);
    expect(keys({ category: "clarify" })).toEqual(["narnia-nota-clarificar-contexto"]);
  });
});
