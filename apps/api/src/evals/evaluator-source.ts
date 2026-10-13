import { readFileSync } from "node:fs";
import { PROMPT_EVALUATORS_DIR } from "@narnia-jobs/core";
import type { PromptEvaluatorDef } from "./prompt-evaluators";

/**
 * Arquivo único de um avaliador para o Phoenix (M3): o sandbox Deno roda sem rede e sem npm, então a publicação junta a
 * base (`lib.ts`) e o módulo do avaliador sem os imports/exports, a configuração embutida e o `evaluate()` com a
 * assinatura que o Phoenix reconhece. O mesmo código roda no Node (testes e comando de avaliações).
 */
const strip = (src: string) =>
  src
    .replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm, "")
    .replace(/^export\s+/gm, "")
    .trim();

const read = (name: string) => readFileSync(new URL(`${name}.ts`, PROMPT_EVALUATORS_DIR), "utf8");

export function buildEvaluatorSource(e: PromptEvaluatorDef): string {
  return [
    `// narnia-jobs · avaliador ${e.phoenixName}`,
    `// gerado de packages/core/src/evals/prompt-evaluators/${e.module}.ts (não edite no Phoenix: a sincronização sobrescreve)`,
    strip(read("lib")),
    strip(read(e.module)),
    `const CONFIG = ${JSON.stringify(e.config)};`,
    "function evaluate({ output, reference, input, metadata }: EvalParams): EvalResult {",
    `  return ${e.fn}({ output, reference, input, metadata }, CONFIG as never);`,
    "}",
    "",
  ].join("\n\n");
}
