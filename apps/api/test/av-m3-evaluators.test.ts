import { STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildEvaluatorSource } from "../src/evals/evaluator-source";
import { PROMPTS_WITH_EVALUATORS, promptEvaluators } from "../src/evals/prompt-evaluators";

/** M3: avaliadores por prompt e o arquivo único publicado no Phoenix (roda sozinho, como no sandbox Deno). */
function runPublished(source: string, params: Record<string, unknown>) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  // sem import/require: só o que o sandbox teria
  return new Function("__inputs", `${js}\nreturn evaluate(__inputs);`)(params) as {
    label: string;
    score: number;
    explanation: string;
  };
}

const out = (v: unknown) => ({ messages: [{ role: "assistant", content: JSON.stringify(v) }] });

describe("avaliadores por prompt", () => {
  it("todos os 8 prompts estruturados têm avaliadores; json_schema sempre presente", () => {
    expect([...PROMPTS_WITH_EVALUATORS].sort()).toEqual(Object.keys(STRUCTURED_PROMPTS).sort());
    for (const op of PROMPTS_WITH_EVALUATORS) {
      const list = promptEvaluators(op);
      expect(list.map((e) => e.name)).toContain("json_schema");
      for (const e of list) {
        expect(e.name).toMatch(/^[a-z_]+$/);
        expect(e.phoenixName).toBe(`${STRUCTURED_PROMPTS[op].name}-${e.name.replaceAll("_", "-")}`);
        expect(e.description.length).toBeGreaterThan(10);
      }
    }
    expect(promptEvaluators("extractFacts").map((e) => e.name)).toEqual([
      "json_schema",
      "citacoes_literais",
      "sem_anos_inventados",
      "cobertura_da_referencia",
    ]);
  });

  it("o arquivo publicado roda sozinho e dá o mesmo resultado que o módulo", () => {
    for (const op of PROMPTS_WITH_EVALUATORS)
      for (const e of promptEvaluators(op)) {
        const source = buildEvaluatorSource(e);
        expect(source).not.toMatch(/^\s*(import|export)\s/m);
        expect(source).toMatch(/function evaluate\(\{ output, reference, input, metadata \}/);
        const params = {
          output: out({ files: [], results: [], suggestions: [], experiences: [] }),
          input: {
            text: "Acme 2021",
            locale: "pt-BR",
            items_json: "[]",
            history_json: "{}",
            max_files: "3",
            tree: "",
          },
          reference: {},
          metadata: {},
        };
        expect(runPublished(source, params)).toEqual(e.run(params));
      }
  });

  it("json_schema publicado leva o schema do prompt embutido", () => {
    const e = promptEvaluators("checkProposals").find((x) => x.name === "json_schema");
    const src = buildEvaluatorSource(e as never);
    expect(src).toContain(JSON.stringify(STRUCTURED_PROMPTS.checkProposals.jsonSchema));
    expect(runPublished(src, { output: out({ results: "x" }) })).toMatchObject({ score: 0 });
  });
});
