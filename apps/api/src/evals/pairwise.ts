import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type PairOutcome, type PairPick, pairOutcome } from "@narnia-jobs/core";
import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { renderTemplate } from "@narnia-jobs/providers";
import { JUDGE_SYSTEM, type JudgeDef } from "./judges";
import { asText, resolvePath } from "./local-eval";

/**
 * Juiz comparativo do gate pairwise (M7, AV-5): o critério é o padrão de entrega do juiz do próprio prompt
 * (`evals/judges/<prompt>.md`) com a entrada do caso; as duas saídas vão no fim (`evals/judges/pairwise.md`). Cada par é
 * julgado duas vezes com a ordem trocada, e a discordância vira empate (anula o viés de posição).
 */
export const PAIRWISE_NAME = "pairwise";
const PICKS = ["A", "B", "empate"] as const;
const ANSWER_PLACEHOLDER = "(compare as respostas A e B no fim desta mensagem)";

const repoRoot = () => fileURLToPath(new URL("../../../../", import.meta.url));
const template = () => readFileSync(`${repoRoot()}evals/judges/pairwise.md`, "utf8").trim();

/** Variáveis do juiz que vêm da saída do modelo (as que mudam entre a aprovada e a candidata). */
const outputVars = (judge: JudgeDef) =>
  Object.entries(judge.variables).filter(([, path]) => path.startsWith("output"));

export function pairwiseCriteria(judge: JudgeDef, ctx: Record<string, unknown>): string {
  const vars = Object.fromEntries(
    Object.entries(judge.variables).map(([name, path]) => [
      name,
      path.startsWith("output") ? ANSWER_PLACEHOLDER : asText(resolvePath(ctx, path)),
    ]),
  );
  // os rótulos do juiz absoluto (atende/parcial/nao_atende) não valem aqui
  return renderTemplate(judge.body, vars)
    .replace(/\n+Rótulos:[^\n]*(\n[^\n]+)*/g, "")
    .trim();
}

const answerText = (judge: JudgeDef, output: unknown) =>
  outputVars(judge)
    .map(([name, path]) => {
      const value = asText(resolvePath({ output }, path));
      return outputVars(judge).length > 1 ? `<${name}>\n${value}\n</${name}>` : value;
    })
    .join("\n\n");

type Completer = { complete(input: CompleteInput): Promise<CompleteResult> };

async function pick(
  provider: Completer,
  judge: JudgeDef,
  criteria: string,
  a: string,
  b: string,
): Promise<{ pick: PairPick; explanation: string }> {
  const r = await provider.complete({
    system: JUDGE_SYSTEM,
    prompt: renderTemplate(template(), { criterio: criteria, resposta_a: a, resposta_b: b }),
    model: judge.modelName,
    jsonSchema: {
      type: "object",
      properties: {
        vencedor: { type: "string", enum: [...PICKS] },
        explicacao: { type: "string" },
      },
      required: ["vencedor", "explicacao"],
    },
  });
  const out = (r.structured ?? {}) as { vencedor?: string; explicacao?: string };
  const found = PICKS.find((p) => p === out.vencedor);
  return {
    pick: found ?? "empate",
    explanation: found
      ? (out.explicacao ?? "")
      : `escolha inválida do juiz: ${String(out.vencedor)}`,
  };
}

/** Julga um caso: aprovada em A na 1ª chamada, candidata em A na 2ª. */
export async function judgePair(
  provider: Completer,
  judge: JudgeDef,
  ctx: Record<string, unknown>,
  outputs: { approved: unknown; candidate: unknown },
): Promise<{ outcome: PairOutcome; explanation: string }> {
  const criteria = pairwiseCriteria(judge, ctx);
  const approved = answerText(judge, outputs.approved);
  const candidate = answerText(judge, outputs.candidate);
  const [first, swapped] = await Promise.all([
    pick(provider, judge, criteria, approved, candidate),
    pick(provider, judge, criteria, candidate, approved),
  ]);
  const name = (p: PairPick, candidateIs: "A" | "B") =>
    p === "empate" ? "empate" : p === candidateIs ? "candidata" : "aprovada";
  return {
    outcome: pairOutcome(first.pick, swapped.pick),
    explanation: `1ª ordem: ${name(first.pick, "B")} (${first.explanation}) · 2ª ordem: ${name(swapped.pick, "A")} (${swapped.explanation})`,
  };
}

const OUTCOME_SCORE: Record<PairOutcome, number> = { ganhou: 1, empate: 0.5, perdeu: 0 };

/** Avaliação `pairwise` em cada execução do experimento da candidata no Phoenix (placar e motivo por caso). */
export async function recordPairwiseEvaluations(
  items: Array<{ runId: string; outcome: PairOutcome; explanation: string }>,
  o: { baseUrl: string; fetch?: (url: string, init?: RequestInit) => Promise<Response> },
): Promise<void> {
  const f = o.fetch ?? ((url, init) => fetch(url, init));
  for (const it of items) {
    const now = new Date().toISOString();
    const r = await f(`${o.baseUrl}/v1/experiment_evaluations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        experiment_run_id: it.runId,
        name: PAIRWISE_NAME,
        annotator_kind: "LLM",
        start_time: now,
        end_time: now,
        result: {
          label: it.outcome,
          score: OUTCOME_SCORE[it.outcome],
          explanation: it.explanation,
        },
      }),
    });
    if (!r.ok) throw new Error(`Phoenix: avaliação pairwise → ${r.status} ${await r.text()}`);
  }
}
