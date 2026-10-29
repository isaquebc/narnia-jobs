import type { ApprovedEvaluation } from "@narnia-jobs/core";
import { JUDGE_NAME } from "./judges";
import type { PromptDef } from "./prompt-catalog";
import { promptVersionInput } from "./prompt-sync";

/**
 * Experimento de um prompt estruturado no Phoenix (M5): o mesmo que "Run" no Playground sobre o dataset do prompt. Usa
 * a versão com a tag `production`, o modelo pela ponte (ou o provedor Anthropic padrão) e todos os avaliadores presos
 * ao dataset, que o Phoenix roda sozinho (código no Deno, juiz pelo modelo). A assinatura GraphQL chega como HTTP
 * multipart; daqui sai um resumo por avaliador.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface PromptExperimentResult {
  name: string;
  experimentId: string | null;
  runs: number;
  /** Exemplos em que o modelo falhou. */
  errors: string[];
  /** Média por avaliador e os exemplos abaixo de 1 (com a explicação). */
  scores: Record<string, { mean: number; n: number; failed: string[] }>;
  evaluatorErrors: string[];
  /**
   * Por exemplo (id do narnia-jobs): execução, saída e notas da primeira repetição, para o pairwise (M7) e a versão
   * aprovada (AV-6); `samples` traz todas as repetições, em ordem (gate com amostras, 2026-10-29).
   */
  examples: PromptExample[];
}

/** Uma repetição de um exemplo no experimento. */
export interface PromptSample {
  repetition: number;
  runId: string | null;
  output: unknown;
  evaluations: ApprovedEvaluation[];
  error?: string;
}

export interface PromptExample {
  exampleId: string;
  runId: string | null;
  output: unknown;
  evaluations: ApprovedEvaluation[];
  error?: string;
  samples: PromptSample[];
}

const SUBSCRIPTION = `subscription($i: ChatCompletionOverDatasetInput!) {
  chatCompletionOverDataset(input: $i) {
    __typename
    datasetExampleId
    ... on ChatCompletionSubscriptionExperiment { experiment { id } }
    ... on ChatCompletionSubscriptionResult { experimentRun { id output } }
    ... on ChatCompletionSubscriptionError { message }
    ... on EvaluationChunk { evaluatorName error experimentRunEvaluation { name label score explanation } }
  }
}`;
const EVALUATORS = `query($id: ID!) { node(id: $id) { ... on Dataset { datasetEvaluators(first: 100) { edges { node { id name inputMapping { pathMapping literalMapping } } } } } } }`;

/** Partes JSON de uma resposta `multipart/mixed` (assinaturas por HTTP do Phoenix). */
export function parseMultipart(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const chunk of raw.split(/\r?\n--graphql(?:--)?\r?\n?/)) {
    const start = chunk.indexOf("{");
    if (start < 0) continue;
    try {
      const j = JSON.parse(chunk.slice(start).trim()) as {
        payload?: {
          data?: { chatCompletionOverDataset?: unknown };
          errors?: Array<{ message: string }>;
        };
      };
      if (j.payload?.errors?.length)
        throw new Error(j.payload.errors.map((e) => e.message).join("; "));
      const d = j.payload?.data?.chatCompletionOverDataset;
      if (d) out.push(d);
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
  return out;
}

type Chunk = {
  __typename: string;
  datasetExampleId?: string;
  repetitionNumber?: number | null;
  experiment?: { id: string };
  experimentRun?: { id: string; output: unknown } | null;
  message?: string;
  evaluatorName?: string;
  error?: string | null;
  experimentRunEvaluation?: {
    name: string;
    label?: string | null;
    score: number | null;
    explanation: string | null;
  } | null;
};

export async function runPromptExperiment(
  def: PromptDef,
  o: {
    baseUrl: string;
    fetch?: FetchLike;
    customProviderId: string | null;
    commit?: string | null;
    /** Repetições de cada exemplo (amostras do gate); padrão 1. */
    repetitions?: number;
    /** Outra versão no lugar da `production` (lado A do gate: a versão aprovada, achada no histórico). */
    version?: { id: string; def: PromptDef };
  },
): Promise<PromptExperimentResult> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const json = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const r = await f(url, init);
    if (!r.ok) throw new Error(`Phoenix ${url} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const gqlInit = (query: string, variables: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const versionId =
    o.version?.id ??
    (
      await json<{ data: { id: string } }>(
        `${o.baseUrl}/v1/prompts/${encodeURIComponent(def.name)}/tags/production`,
      )
    ).data.id;
  const dataset = (
    await json<{ data: Array<{ id: string; name: string }> }>(
      `${o.baseUrl}/v1/datasets?name=${encodeURIComponent(def.name)}`,
    )
  ).data.find((d) => d.name === def.name);
  if (!dataset) throw new Error(`Dataset ${def.name} não existe no Phoenix: sincronize antes`);
  // nomes legíveis dos exemplos (o id que o narnia-jobs deu, em input.id) no lugar do id interno do Phoenix
  const examples = await f(`${o.baseUrl}/v1/datasets/${encodeURIComponent(dataset.id)}/examples`)
    .then(async (r) =>
      r.ok
        ? (
            (await r.json()) as {
              data: { examples: Array<{ id: string; input: { id?: string } }> };
            }
          ).data.examples
        : [],
    )
    .catch(() => []);
  const label = new Map(examples.map((e) => [e.id, e.input.id ?? e.id]));
  const ex = (id: string | undefined) => (id ? (label.get(id) ?? id) : "?");
  const evaluators =
    (
      await json<{
        data: {
          node: {
            datasetEvaluators?: {
              edges: Array<{
                node: {
                  id: string;
                  name: string;
                  inputMapping: { pathMapping: unknown; literalMapping: unknown };
                };
              }>;
            };
          };
        };
      }>(`${o.baseUrl}/graphql`, gqlInit(EVALUATORS, { id: dataset.id }))
    ).data.node.datasetEvaluators?.edges.map((e) => ({
      id: e.node.id,
      name: e.node.name,
      inputMapping: {
        pathMapping: e.node.inputMapping.pathMapping ?? {},
        literalMapping: e.node.inputMapping.literalMapping ?? {},
      },
    })) ?? [];
  const input = {
    promptVersionId: versionId,
    promptVersion: promptVersionInput(o.version?.def ?? def, {
      customProviderId: o.customProviderId,
      commit: o.commit ?? null,
    }),
    datasetId: dataset.id,
    repetitions: o.repetitions ?? 1,
    streamModelOutput: false,
    tracingEnabled: true,
    templateVariablesPath: "input",
    experimentName: `${def.name}${o.version ? " · aprovada" : ""} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    experimentDescription: "narnia-jobs: rodada de regressão do prompt (comando de avaliações)",
    evaluators,
  };
  const r = await f(`${o.baseUrl}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: 'multipart/mixed;subscriptionSpec="1.0", application/json',
    },
    body: JSON.stringify({ query: SUBSCRIPTION, variables: { i: input } }),
  });
  if (!r.ok) throw new Error(`Phoenix: experimento de ${def.name} → ${r.status} ${await r.text()}`);
  const chunks = parseMultipart(await r.text()) as Chunk[];
  const out: PromptExperimentResult = {
    name: def.name,
    experimentId: null,
    runs: 0,
    errors: [],
    scores: {},
    evaluatorErrors: [],
    examples: [],
  };
  const byExample = new Map<string, Map<number, PromptSample>>();
  const sampleOf = (c: Chunk) => {
    const key = ex(c.datasetExampleId);
    const rep = c.repetitionNumber ?? 1;
    let reps = byExample.get(key);
    if (!reps) {
      reps = new Map();
      byExample.set(key, reps);
    }
    let e = reps.get(rep);
    if (!e) {
      e = { repetition: rep, runId: null, output: null, evaluations: [] };
      reps.set(rep, e);
    }
    return e;
  };
  const where = (c: Chunk) =>
    `${ex(c.datasetExampleId)}${(c.repetitionNumber ?? 1) > 1 ? ` (repetição ${c.repetitionNumber})` : ""}`;
  const acc: Record<string, { sum: number; n: number; failed: string[] }> = {};
  for (const c of chunks) {
    if (c.__typename === "ChatCompletionSubscriptionExperiment")
      out.experimentId = c.experiment?.id ?? null;
    else if (c.__typename === "ChatCompletionSubscriptionResult") {
      out.runs++;
      const e = sampleOf(c);
      e.runId = c.experimentRun?.id ?? null;
      e.output = c.experimentRun?.output ?? null;
    } else if (c.__typename === "ChatCompletionSubscriptionError") {
      out.errors.push(`${where(c)}: ${c.message}`);
      sampleOf(c).error = c.message ?? "erro do modelo";
    } else if (c.__typename === "EvaluationChunk") {
      const ev = c.experimentRunEvaluation;
      if (c.error || !ev || ev.score === null) {
        out.evaluatorErrors.push(`${c.evaluatorName} (${where(c)}): ${c.error ?? "sem nota"}`);
        continue;
      }
      const a = acc[ev.name] ?? { sum: 0, n: 0, failed: [] };
      acc[ev.name] = a;
      sampleOf(c).evaluations.push({
        name: ev.name,
        kind: ev.name === JUDGE_NAME ? "LLM" : "CODE",
        label: ev.label ?? "",
        score: ev.score,
        explanation: ev.explanation ?? "",
      });
      a.sum += ev.score;
      a.n++;
      if (ev.score < 1) a.failed.push(`${where(c)}: ${ev.explanation ?? ""}`);
    }
  }
  for (const [name, a] of Object.entries(acc))
    out.scores[name] = { mean: a.sum / a.n, n: a.n, failed: a.failed };
  out.examples = [...byExample.entries()].map(([exampleId, reps]) => {
    const samples = [...reps.values()].sort((a, b) => a.repetition - b.repetition);
    const { repetition: _r, ...first } = samples[0] as PromptSample;
    return { exampleId, ...first, samples };
  });
  return out;
}

/**
 * Junta experimentos de uma repetição cada (gate com amostras, 2026-10-29): a ponte da assinatura atende 2 chamadas e
 * enfileira 8, e as N repetições num experimento só saíam todas de uma vez ("rate limit"). A k-ésima vira a repetição k.
 */
export function mergeRepetitions(results: PromptExperimentResult[]): PromptExperimentResult {
  const tag = (k: number, text: string) => (k > 1 ? `${text} (repetição ${k})` : text);
  const scores: PromptExperimentResult["scores"] = {};
  const examples = new Map<string, PromptExample>();
  results.forEach((r, i) => {
    const k = i + 1;
    for (const [name, s] of Object.entries(r.scores)) {
      const a = scores[name] ?? { mean: 0, n: 0, failed: [] };
      const n = a.n + s.n;
      scores[name] = {
        mean: n ? (a.mean * a.n + s.mean * s.n) / n : 0,
        n,
        failed: [...a.failed, ...s.failed.map((f) => tag(k, f))],
      };
    }
    for (const e of r.examples) {
      const cur = examples.get(e.exampleId) ?? { ...e, samples: [] };
      const samples = e.samples.map((x) => ({ ...x, repetition: k }));
      examples.set(e.exampleId, { ...cur, samples: [...cur.samples, ...samples] });
    }
  });
  const first = results[0];
  return {
    name: first?.name ?? "",
    experimentId: first?.experimentId ?? null,
    runs: results.reduce((n, r) => n + r.runs, 0),
    errors: results.flatMap((r, i) => r.errors.map((e) => tag(i + 1, e))),
    scores,
    evaluatorErrors: results.flatMap((r, i) => r.evaluatorErrors.map((e) => tag(i + 1, e))),
    examples: [...examples.values()],
  };
}

/**
 * A versão aprovada no histórico do Phoenix (lado A do gate dos estruturados, 2026-10-29): a sincronização grava o
 * hash do repositório na metadata de cada versão, e a aprovada guarda esse hash (`versionId`). Null se o histórico não
 * tem a versão (Phoenix zerado): o lado A volta a ser a saída guardada.
 */
export async function approvedPromptVersion(
  def: PromptDef,
  hash: string,
  o: { baseUrl: string; fetch?: FetchLike },
): Promise<{ id: string; def: PromptDef } | null> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const r = await f(`${o.baseUrl}/v1/prompts/${encodeURIComponent(def.name)}/versions`);
  if (!r.ok) return null;
  type Version = {
    id: string;
    metadata?: { hash?: string };
    model_name?: string;
    template?: { messages?: Array<{ role: string; content: Array<{ text?: string }> | string }> };
    response_format?: { json_schema?: { name?: string; schema?: Record<string, unknown> } };
  };
  const v = ((await r.json()) as { data?: Version[] }).data?.find((x) => x.metadata?.hash === hash);
  if (!v) return null;
  const text = (c: Array<{ text?: string }> | string) =>
    typeof c === "string" ? c : c.map((p) => p.text ?? "").join("");
  return {
    id: v.id,
    def: {
      ...def,
      hash,
      modelName: v.model_name ?? def.modelName,
      messages: (v.template?.messages ?? []).map((m) => ({
        role: m.role.toUpperCase() === "SYSTEM" ? "SYSTEM" : "USER",
        content: text(m.content),
      })),
      jsonSchema: v.response_format?.json_schema?.schema ?? null,
      schemaName: v.response_format?.json_schema?.name ?? null,
    },
  };
}
