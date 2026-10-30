import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { chatJudge } from "../src/evals/judges";
import { judgeLocally } from "../src/evals/local-eval";
import { pairwiseCriteria } from "../src/evals/pairwise";

/**
 * Juiz do recrutador em perguntas de sim/não (F04-fix-fundamentacao, R3, FF-4): cada pergunta descreve um defeito
 * (G grave, D detalhe); o modelo responde por pergunta com o trecho, e o rótulo sai por código. Um rótulo único para
 * cinco critérios oscilava com qualquer detalhe.
 */
const reply = (structured: unknown): CompleteResult => ({
  text: "",
  structured,
  model: "m",
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: "m" },
  costUsd: 0,
});
const ctx = { input: { messages: ["oi"], context: "" }, output: { replies: ["Olá"], tools: [] } };

describe("juiz do recrutador com perguntas", () => {
  it("lê as perguntas do arquivo com o id e a gravidade", () => {
    const j = chatJudge();
    expect(j.checks?.map((c) => `${c.id}:${c.severity}`)).toEqual(
      expect.arrayContaining(["G1:grave", "G2:grave", "D1:detalhe", "D4:detalhe"]),
    );
  });

  it("grave → nao_atende; só detalhe → parcial; nenhum → atende; a explicação cita o defeito e o trecho", async () => {
    const j = chatJudge();
    let input: CompleteInput | undefined;
    const run = async (itens: Array<{ id: string; defeito: boolean; trecho: string }>) =>
      judgeLocally(
        {
          complete: async (i) => {
            input = i;
            return reply({ itens });
          },
        },
        j,
        ctx,
      );
    const grave = await run([
      { id: "G2", defeito: true, trecho: "mentoria não está no seu perfil" },
      { id: "D4", defeito: true, trecho: "quer A, B ou C?" },
    ]);
    expect(grave).toMatchObject({ label: "nao_atende", score: 0 });
    expect(grave.explanation).toMatch(/G2.*mentoria não está no seu perfil/);
    expect(input?.jsonSchema).toMatchObject({ required: ["itens"] });
    expect(input?.prompt).toMatch(/responda por defeito/i);
    expect((await run([{ id: "D1", defeito: true, trecho: "o mercado procura" }])).label).toBe(
      "parcial",
    );
    expect((await run([{ id: "G1", defeito: false, trecho: "" }])).label).toBe("atende");
  });

  it("no pairwise as perguntas viram critério, sem os rótulos", () => {
    const c = pairwiseCriteria(chatJudge(), { input: { messages: ["oi"], context: "" } });
    expect(c).toMatch(/G2 grave/);
    expect(c).not.toMatch(/Rótulos:/);
  });
});
