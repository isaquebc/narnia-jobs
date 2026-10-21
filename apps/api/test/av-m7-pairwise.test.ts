import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { chatJudge, judgeFor } from "../src/evals/judges";
import { judgePair, pairwiseCriteria } from "../src/evals/pairwise";

/** M7 (AV-5) · juiz comparativo: critério do juiz de cada prompt, duas respostas, ordem trocada na segunda chamada. */
const reply = (vencedor: string, explicacao = "porque sim") =>
  ({
    text: "",
    structured: { vencedor, explicacao },
    model: "m",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "m",
    },
    costUsd: 0,
  }) as CompleteResult;

function scripted(picks: string[]) {
  const seen: CompleteInput[] = [];
  return {
    seen,
    provider: {
      complete: async (i: CompleteInput) => {
        seen.push(i);
        return reply(picks[seen.length - 1] ?? "empate");
      },
    },
  };
}

const cvCtx = { input: { brief_json: '{"locale":"pt-BR"}' } };
const out = (content: string) => ({ messages: [{ role: "assistant", content }] });

describe("M7 · critério do pairwise", () => {
  it("usa o padrão de entrega do juiz do prompt com a entrada e sem a resposta nem os rótulos absolutos", () => {
    const c = pairwiseCriteria(judgeFor("cvGenerate"), cvCtx);
    expect(c).toContain('{"locale":"pt-BR"}');
    expect(c).toContain("Padrão de entrega");
    expect(c).not.toContain("{{");
    expect(c).not.toMatch(/^Rótulos:/m);
    expect(c).toContain("respostas A e B");
  });
});

describe("M7 · judgePair", () => {
  it("1ª chamada com a aprovada em A, 2ª com a candidata em A; concordância = ganhou", async () => {
    const s = scripted(["B", "A"]);
    const r = await judgePair(s.provider, judgeFor("cvGenerate"), cvCtx, {
      approved: out("APROVADA"),
      candidate: out("CANDIDATA"),
    });
    expect(r.outcome).toBe("ganhou");
    const [first, second] = s.seen;
    expect(first?.prompt.indexOf("APROVADA")).toBeLessThan(first?.prompt.indexOf("CANDIDATA") ?? 0);
    expect(second?.prompt.indexOf("CANDIDATA")).toBeLessThan(
      second?.prompt.indexOf("APROVADA") ?? 0,
    );
    expect(first?.jsonSchema).toMatchObject({
      properties: { vencedor: { enum: ["A", "B", "empate"] } },
    });
    expect(r.explanation).toMatch(/porque sim/);
  });

  it("viés de posição (A nas duas) vira empate; derrota quando a aprovada vence nas duas ordens", async () => {
    const tie = await judgePair(scripted(["A", "A"]).provider, judgeFor("cvGenerate"), cvCtx, {
      approved: out("x"),
      candidate: out("y"),
    });
    expect(tie.outcome).toBe("empate");
    const loss = await judgePair(scripted(["A", "B"]).provider, judgeFor("cvGenerate"), cvCtx, {
      approved: out("x"),
      candidate: out("y"),
    });
    expect(loss.outcome).toBe("perdeu");
  });

  it("chat: as duas respostas trazem respostas e ferramentas do recrutador", async () => {
    const s = scripted(["B", "A"]);
    await judgePair(
      s.provider,
      chatJudge(),
      { input: { messages: ["oi"], context: "cartões" } },
      {
        approved: { replies: ["resposta velha"], tools: ["a"] },
        candidate: { replies: ["resposta nova"], tools: ["b"] },
      },
    );
    expect(s.seen[0]?.prompt).toContain("resposta velha");
    expect(s.seen[0]?.prompt).toContain("resposta nova");
    expect(s.seen[0]?.prompt).toContain("cartões");
  });
});
