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
}

const SUBSCRIPTION = `subscription($i: ChatCompletionOverDatasetInput!) {
  chatCompletionOverDataset(input: $i) {
    __typename
    datasetExampleId
    ... on ChatCompletionSubscriptionExperiment { experiment { id } }
    ... on ChatCompletionSubscriptionResult { experimentRun { id } }
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
  experiment?: { id: string };
  message?: string;
  evaluatorName?: string;
  error?: string | null;
  experimentRunEvaluation?: {
    name: string;
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
  const production = await json<{ data: { id: string } }>(
    `${o.baseUrl}/v1/prompts/${encodeURIComponent(def.name)}/tags/production`,
  );
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
    promptVersionId: production.data.id,
    promptVersion: promptVersionInput(def, {
      customProviderId: o.customProviderId,
      commit: o.commit ?? null,
    }),
    datasetId: dataset.id,
    repetitions: 1,
    streamModelOutput: false,
    tracingEnabled: true,
    templateVariablesPath: "input",
    experimentName: `${def.name} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
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
  };
  const acc: Record<string, { sum: number; n: number; failed: string[] }> = {};
  for (const c of chunks) {
    if (c.__typename === "ChatCompletionSubscriptionExperiment")
      out.experimentId = c.experiment?.id ?? null;
    else if (c.__typename === "ChatCompletionSubscriptionResult") out.runs++;
    else if (c.__typename === "ChatCompletionSubscriptionError")
      out.errors.push(`${ex(c.datasetExampleId)}: ${c.message}`);
    else if (c.__typename === "EvaluationChunk") {
      const ev = c.experimentRunEvaluation;
      if (c.error || !ev || ev.score === null) {
        out.evaluatorErrors.push(
          `${c.evaluatorName} (${ex(c.datasetExampleId)}): ${c.error ?? "sem nota"}`,
        );
        continue;
      }
      const a = acc[ev.name] ?? { sum: 0, n: 0, failed: [] };
      acc[ev.name] = a;
      a.sum += ev.score;
      a.n++;
      if (ev.score < 1) a.failed.push(`${ex(c.datasetExampleId)}: ${ev.explanation ?? ""}`);
    }
  }
  for (const [name, a] of Object.entries(acc))
    out.scores[name] = { mean: a.sum / a.n, n: a.n, failed: a.failed };
  return out;
}
