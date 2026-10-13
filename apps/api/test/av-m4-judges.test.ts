import { STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { JUDGE_LABELS, JUDGE_NAME, judgeFor, judgePromptVersion } from "../src/evals/judges";
import { PROMPTS_WITH_EVALUATORS } from "../src/evals/prompt-evaluators";

/** M4: juízes (avaliadores com modelo) com o padrão de entrega de cada prompt estruturado. */
describe("juízes do padrão de entrega", () => {
  it("um juiz por prompt; variáveis do texto = variáveis mapeadas, todas por caminho do contexto", () => {
    for (const op of PROMPTS_WITH_EVALUATORS) {
      const j = judgeFor(op);
      expect(j.file).toBe(`evals/judges/${STRUCTURED_PROMPTS[op].name}.md`);
      const used = new Set([...j.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
      expect([...used].sort()).toEqual(Object.keys(j.variables).sort());
      for (const path of Object.values(j.variables))
        expect(path).toMatch(/^(input|output|reference)\b/);
      expect(j.variables.resposta ?? "output.messages[0].content").toBe(
        "output.messages[0].content",
      );
      expect(j.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("versão do juiz no formato que o Phoenix valida: tool com rótulos, explicação, escolha obrigatória e a ponte", () => {
    const pv = judgePromptVersion(judgeFor("extractFacts"), "CP1");
    expect(pv).toMatchObject({
      templateFormat: "MUSTACHE",
      modelProvider: "ANTHROPIC",
      customProviderId: "CP1",
      metadata: { hash: judgeFor("extractFacts").hash },
      tools: {
        toolChoice: { oneOrMore: true },
        tools: [
          {
            function: {
              name: JUDGE_NAME,
              description: judgeFor("extractFacts").description,
              parameters: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    enum: JUDGE_LABELS.map((l) => l.label),
                    description: JUDGE_NAME,
                  },
                  explanation: { type: "string" },
                },
                required: ["label", "explanation"],
              },
            },
          },
        ],
      },
    });
    expect(pv).not.toHaveProperty("responseFormat");
    expect(pv.template.messages.map((m) => m.role)).toEqual(["SYSTEM", "USER"]);
    expect(JUDGE_LABELS).toEqual([
      { label: "atende", score: 1 },
      { label: "parcial", score: 0.5 },
      { label: "nao_atende", score: 0 },
    ]);
  });
});
