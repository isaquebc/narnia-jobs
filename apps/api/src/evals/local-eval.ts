import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { renderTemplate } from "@narnia-jobs/providers";
import { JUDGE_LABELS, JUDGE_SYSTEM, type JudgeDef } from "./judges";

/**
 * Avaliação fora do Playground (M5): o recrutador (sandbox isolado) e a leitura de PDF (usa a tool Read) não rodam no
 * Phoenix; o comando roda, aplica os mesmos avaliadores de código e o mesmo juiz (texto e variáveis do Phoenix) pela
 * assinatura e grava o experimento no dataset do prompt, com as avaliações.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface LocalEvaluation {
  name: string;
  kind: "CODE" | "LLM";
  label: string;
  score: number;
  explanation: string;
}

/** Valor no contexto por caminho com pontos e índices (`output.messages[0].content`), como o JSONPath do Phoenix. */
export function resolvePath(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const asText = (v: unknown) =>
  v === undefined
    ? ""
    : typeof v === "string"
      ? v
      : Array.isArray(v) && v.every((x) => typeof x === "string")
        ? v.join("\n\n")
        : JSON.stringify(v, null, 1);

/** Roda o juiz pela assinatura: mesmo texto, variáveis resolvidas do contexto e rótulo como saída estruturada. */
export async function judgeLocally(
  provider: { complete(input: CompleteInput): Promise<CompleteResult> },
  judge: JudgeDef,
  ctx: Record<string, unknown>,
): Promise<{ name: string; label: string; score: number; explanation: string }> {
  const vars = Object.fromEntries(
    Object.entries(judge.variables).map(([name, path]) => [name, asText(resolvePath(ctx, path))]),
  );
  const r = await provider.complete({
    system: JUDGE_SYSTEM,
    prompt: renderTemplate(judge.body, vars),
    model: judge.modelName,
    jsonSchema: {
      type: "object",
      properties: {
        label: { type: "string", enum: JUDGE_LABELS.map((l) => l.label) },
        explanation: { type: "string" },
      },
      required: ["label", "explanation"],
    },
  });
  const out = (r.structured ?? {}) as { label?: string; explanation?: string };
  const found = JUDGE_LABELS.find((l) => l.label === out.label);
  return {
    name: judge.name,
    label: found?.label ?? "nao_atende",
    score: found?.score ?? 0,
    explanation: found ? (out.explanation ?? "") : `rótulo inválido do juiz: ${String(out.label)}`,
  };
}

export interface LocalRun {
  /** Id do exemplo dado pelo narnia-jobs (`input.id` no dataset). */
  exampleId: string;
  output: unknown;
  startedAt: string;
  endedAt: string;
  error?: string;
  evaluations: LocalEvaluation[];
}

/** Grava um experimento no dataset do Phoenix: uma execução por exemplo conhecido e as avaliações de cada uma. */
export async function recordLocalExperiment(
  e: { dataset: string; name: string; description?: string; runs: LocalRun[] },
  o: { baseUrl: string; fetch?: FetchLike },
): Promise<{ experimentId: string; runs: number }> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const r = await f(
      `${o.baseUrl}${path}`,
      body
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {},
    );
    if (!r.ok) throw new Error(`Phoenix ${path} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const dataset = (
    await call<{ data: Array<{ id: string; name: string }> }>(
      `/v1/datasets?name=${encodeURIComponent(e.dataset)}`,
    )
  ).data.find((d) => d.name === e.dataset);
  if (!dataset) throw new Error(`Dataset ${e.dataset} não existe no Phoenix: sincronize antes`);
  const examples = await call<{
    data: { examples: Array<{ id: string; input: { id?: string } }> };
  }>(`/v1/datasets/${encodeURIComponent(dataset.id)}/examples`);
  const byId = new Map(examples.data.examples.map((x) => [x.input.id, x.id]));
  const experiment = await call<{ data: { id: string } }>(
    `/v1/datasets/${encodeURIComponent(dataset.id)}/experiments`,
    {
      name: e.name,
      description: e.description ?? "narnia-jobs: rodada do comando de avaliações",
      metadata: { source: "narnia-jobs evals" },
    },
  );
  let runs = 0;
  for (const r of e.runs) {
    const exampleId = byId.get(r.exampleId);
    if (!exampleId) continue;
    const run = await call<{ data: { id: string } }>(`/v1/experiments/${experiment.data.id}/runs`, {
      dataset_example_id: exampleId,
      output: r.output,
      repetition_number: 1,
      start_time: r.startedAt,
      end_time: r.endedAt,
      ...(r.error ? { error: r.error } : {}),
    });
    runs++;
    for (const ev of r.evaluations)
      await call("/v1/experiment_evaluations", {
        experiment_run_id: run.data.id,
        name: ev.name,
        annotator_kind: ev.kind,
        start_time: r.endedAt,
        end_time: r.endedAt,
        result: { label: ev.label, score: ev.score, explanation: ev.explanation },
      });
  }
  return { experimentId: experiment.data.id, runs };
}
