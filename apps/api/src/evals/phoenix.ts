import type { EvalCase } from "@narnia-jobs/core";
import type { EvalCaseReport } from "./run";

/**
 * Auditoria E2 (19b) · rodada das avaliações do chat como experimento no Phoenix local, pela API REST dele (sem
 * dependência nova): os casos de `evals/chat/` viram o dataset `narnia-chat` (criado ou atualizado), cada rodada um
 * experimento, cada caso uma execução e cada avaliador uma avaliação `CODE` (passou = 1, falhou = 0). As respostas
 * do recrutador só vão junto com `NARNIA_OTEL_CONTENT=1`, como nos rastros.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const PHOENIX_DATASET = "narnia-chat";

export interface PhoenixExperimentOptions {
  /** Origem do Phoenix, ex. `http://phoenix:6006`. */
  baseUrl: string;
  fetch?: FetchLike;
  /** Nome do experimento (ex. "chat claude-code 2026-10-12T12:00"). */
  name: string;
  /** Inclui as respostas do recrutador (NARNIA_OTEL_CONTENT=1). */
  content: boolean;
}

export async function recordPhoenixExperiment(
  cases: EvalCase[],
  reports: EvalCaseReport[],
  o: PhoenixExperimentOptions,
): Promise<{ datasetId: string; experimentId: string; runs: number }> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const base = o.baseUrl.replace(/\/+$/, "");
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {};
    const r = await f(`${base}${path}`, init);
    if (!r.ok)
      throw new Error(`Phoenix ${init.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };

  const existing = await call<{ data: Array<{ id: string; name: string }> }>(
    `/v1/datasets?name=${encodeURIComponent(PHOENIX_DATASET)}`,
  );
  const found = existing.data.find((d) => d.name === PHOENIX_DATASET);
  const upload = await call<{ data: { dataset_id: string } }>("/v1/datasets/upload?sync=true", {
    action: found ? "update" : "create",
    name: PHOENIX_DATASET,
    description: "Conversas de referência do recrutador (evals/chat)",
    inputs: cases.map((c) => ({ id: c.id, category: c.category, messages: c.messages })),
    outputs: cases.map((c) => ({ graders: c.graders })),
    metadata: cases.map((c) => ({ description: c.description ?? "" })),
  });
  const datasetId = upload.data.dataset_id;
  const examples = await call<{
    data: { examples: Array<{ id: string; input: { id?: string } }> };
  }>(`/v1/datasets/${datasetId}/examples`);
  const exampleOf = new Map(examples.data.examples.map((e) => [e.input.id, e.id]));
  const experiment = await call<{ data: { id: string } }>(`/v1/datasets/${datasetId}/experiments`, {
    name: o.name,
    metadata: { source: "scripts/claude-env.sh evals" },
  });
  const experimentId = experiment.data.id;
  let runs = 0;
  for (const r of reports) {
    const exampleId = exampleOf.get(r.id);
    if (!exampleId) continue;
    const run = await call<{ data: { id: string } }>(`/v1/experiments/${experimentId}/runs`, {
      dataset_example_id: exampleId,
      output: {
        passed: r.passed,
        sessionId: r.sessionId,
        tools: r.tools,
        ...(o.content ? { replies: r.replies } : {}),
      },
      repetition_number: 1,
      start_time: r.startedAt,
      end_time: r.endedAt,
      ...(r.error ? { error: r.error } : {}),
    });
    runs++;
    for (const g of r.results) {
      await call("/v1/experiment_evaluations", {
        experiment_run_id: run.data.id,
        name: g.type,
        annotator_kind: "CODE",
        start_time: r.endedAt,
        end_time: r.endedAt,
        result: {
          label: g.passed ? "passou" : "falhou",
          score: g.passed ? 1 : 0,
          explanation: g.detail,
        },
      });
    }
    // juízes com modelo (padrão de entrega do recrutador)
    for (const j of r.judges ?? []) {
      await call("/v1/experiment_evaluations", {
        experiment_run_id: run.data.id,
        name: j.name,
        annotator_kind: "LLM",
        start_time: r.endedAt,
        end_time: r.endedAt,
        result: { label: j.label, score: j.score, explanation: j.explanation },
      });
    }
  }
  return { datasetId, experimentId, runs };
}
