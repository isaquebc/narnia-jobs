import { STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { buildEvaluatorSource } from "./evaluator-source";
import {
  chatJudge,
  JUDGE_NAME,
  type JudgeDef,
  judgeFor,
  judgeOutputConfig,
  judgePromptVersion,
} from "./judges";
import { datasetRows, PROMPT_DATASETS } from "./prompt-datasets";
import { PROMPTS_WITH_EVALUATORS, promptEvaluators } from "./prompt-evaluators";

/**
 * Datasets e avaliadores de código no Phoenix (M3): um dataset por prompt estruturado (nome do prompt), os avaliadores
 * em TypeScript (sandbox Deno local) versionados (fonte diferente = versão nova) e presos ao dataset, para rodarem
 * sozinhos a cada experimento do Playground sobre ele.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface EvalSyncResult {
  datasets: number;
  evaluatorsCreated: number;
  evaluatorsUpdated: number;
  attached: number;
  judgesCreated: number;
  judgesUpdated: number;
}

const SANDBOXES = `{ sandboxProviders { backendType configs { id name language } } }`;
const EVALUATORS = `{ evaluators(first: 500) { edges { node { id name ... on CodeEvaluator { sourceCode } } } } }`;
const CREATE = `mutation($input: CreateCodeEvaluatorInput!) { createCodeEvaluator(input: $input) { evaluator { id } } }`;
const VERSION = `mutation($input: CreateCodeEvaluatorVersionInput!) { createCodeEvaluatorVersion(input: $input) { __typename } }`;
const ATTACHED = `query($id: ID!) { node(id: $id) { ... on Dataset { datasetEvaluators(first: 100) { edges { node { id name evaluator { ... on LLMEvaluator { promptVersion { metadata } } } } } } } } }`;
const CREATE_JUDGE = `mutation($input: CreateDatasetLLMEvaluatorInput!) { createDatasetLlmEvaluator(input: $input) { __typename } }`;
const UPDATE_JUDGE = `mutation($input: UpdateDatasetLLMEvaluatorInput!) { updateDatasetLlmEvaluator(input: $input) { __typename } }`;
const ATTACH = `mutation($input: CreateDatasetCodeEvaluatorInput!) { createDatasetCodeEvaluator(input: $input) { __typename } }`;
const CREATE_SANDBOX = `mutation($input: CreateSandboxConfigInput!) { createSandboxConfig(input: $input) { __typename } }`;

const INPUT_MAPPING = {
  pathMapping: { output: "output", input: "input", reference: "reference", metadata: "metadata" },
  literalMapping: {},
};

const outputConfig = (name: string, description: string) => [
  {
    continuous: {
      name,
      description,
      optimizationDirection: "MAXIMIZE",
      lowerBound: 0,
      upperBound: 1,
    },
  },
];

export async function syncEvaluators(o: {
  baseUrl: string;
  fetch?: FetchLike;
  /** Provedor da ponte (`narnia-assinatura`) para os juízes; null = provedor Anthropic padrão. */
  customProviderId?: string | null;
}): Promise<EvalSyncResult> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const gql = async <T>(query: string, variables?: unknown): Promise<T> => {
    const r = await f(`${o.baseUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });
    if (!r.ok) throw new Error(`Phoenix GraphQL → ${r.status}`);
    const body = (await r.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length)
      throw new Error(`Phoenix: ${body.errors.map((e) => e.message).join("; ")}`);
    return body.data as T;
  };
  const rest = async <T>(path: string, body?: unknown): Promise<T> => {
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

  // sandbox Deno (TypeScript): o padrão da imagem; sem ele, cria um
  type Sandboxes = {
    sandboxProviders: Array<{
      backendType: string;
      configs: Array<{ id: string; language?: string }>;
    }>;
  };
  const findSandbox = (d: Sandboxes) =>
    d.sandboxProviders
      .find((p) => p.backendType === "DENO")
      ?.configs.find((c) => !c.language || c.language === "TYPESCRIPT")?.id;
  let sandboxId = findSandbox(await gql<Sandboxes>(SANDBOXES));
  if (!sandboxId) {
    await gql(CREATE_SANDBOX, {
      input: {
        name: "narnia-deno",
        description: "Avaliadores do narnia-jobs",
        config: { deno: { language: "TYPESCRIPT" } },
        enabled: true,
        timeout: 30,
      },
    });
    sandboxId = findSandbox(await gql<Sandboxes>(SANDBOXES));
  }
  if (!sandboxId) throw new Error("Phoenix sem sandbox Deno para avaliadores em TypeScript");

  const existing = new Map(
    (
      await gql<{
        evaluators: { edges: Array<{ node: { id: string; name: string; sourceCode?: string } }> };
      }>(EVALUATORS)
    ).evaluators.edges.map((e) => [e.node.name, e.node]),
  );
  const out: EvalSyncResult = {
    datasets: 0,
    evaluatorsCreated: 0,
    evaluatorsUpdated: 0,
    attached: 0,
    judgesCreated: 0,
    judgesUpdated: 0,
  };
  for (const op of PROMPTS_WITH_EVALUATORS) {
    const spec = STRUCTURED_PROMPTS[op];
    const rows = datasetRows(op);
    const found = (
      await rest<{ data: Array<{ id: string; name: string }> }>(
        `/v1/datasets?name=${encodeURIComponent(spec.name)}`,
      )
    ).data.find((d) => d.name === spec.name);
    const upload = await rest<{ data: { dataset_id: string } }>("/v1/datasets/upload?sync=true", {
      action: found ? "update" : "create",
      name: spec.name,
      description: `Exemplos do prompt ${spec.name}: ${spec.description}${spec.tools.length ? " (usa tools: rode pelo comando de avaliações, não pelo Playground)" : ""}`,
      inputs: rows.map((r) => r.input),
      outputs: rows.map((r) => r.output),
      metadata: rows.map((r) => r.metadata),
    });
    out.datasets++;
    const datasetId = upload.data.dataset_id;
    type Attached = {
      id: string;
      name: string;
      evaluator?: { promptVersion?: { metadata?: { hash?: string } } };
    };
    const attachedList: Attached[] =
      (
        await gql<{ node: { datasetEvaluators?: { edges: Array<{ node: Attached }> } } | null }>(
          ATTACHED,
          {
            id: datasetId,
          },
        )
      ).node?.datasetEvaluators?.edges.map((e) => e.node) ?? [];
    const attached = new Set(attachedList.map((a) => a.name));
    for (const e of promptEvaluators(op)) {
      const source = buildEvaluatorSource(e);
      let evaluatorId = existing.get(e.phoenixName)?.id;
      if (!evaluatorId) {
        const created = await gql<{ createCodeEvaluator: { evaluator: { id: string } } }>(CREATE, {
          input: {
            name: e.phoenixName,
            description: e.description,
            language: "TYPESCRIPT",
            sourceCode: source,
            sandboxConfigId: sandboxId,
            inputMapping: INPUT_MAPPING,
            outputConfigs: outputConfig(e.name, e.description),
          },
        });
        evaluatorId = created.createCodeEvaluator.evaluator.id;
        out.evaluatorsCreated++;
      } else if (existing.get(e.phoenixName)?.sourceCode !== source) {
        await gql(VERSION, { input: { codeEvaluatorId: evaluatorId, sourceCode: source } });
        out.evaluatorsUpdated++;
      }
      if (!attached.has(e.name)) {
        await gql(ATTACH, {
          input: {
            datasetId,
            evaluatorId,
            name: e.name,
            description: e.description,
            inputMapping: {
              pathMapping: {
                output: "output",
                input: "input",
                reference: "reference",
                metadata: "metadata",
              },
              literalMapping: {},
            },
            outputConfigs: outputConfig(e.name, e.description),
          },
        });
        out.attached++;
      }
    }
    // juiz do padrão de entrega (M4): cria; texto mudou (hash) = versão nova pelo update
    const action = await upsertJudge(
      gql,
      datasetId,
      attachedList,
      judgeFor(op),
      o.customProviderId ?? null,
    );
    if (action === "created") out.judgesCreated++;
    if (action === "updated") out.judgesUpdated++;
  }
  return out;
}

type Gql = <T>(query: string, variables?: unknown) => Promise<T>;
type Attached = {
  id: string;
  name: string;
  evaluator?: { promptVersion?: { metadata?: { hash?: string } } };
};

async function upsertJudge(
  gql: Gql,
  datasetId: string,
  attachedList: Attached[],
  judge: JudgeDef,
  customProviderId: string | null,
): Promise<"created" | "updated" | "unchanged"> {
  const current = attachedList.find((a) => a.name === JUDGE_NAME);
  const input = {
    datasetId,
    name: JUDGE_NAME,
    description: judge.description,
    promptVersion: judgePromptVersion(judge, customProviderId),
    outputConfigs: judgeOutputConfig(judge),
    inputMapping: { pathMapping: judge.variables, literalMapping: {} },
  };
  if (!current) {
    await gql(CREATE_JUDGE, { input });
    return "created";
  }
  if (current.evaluator?.promptVersion?.metadata?.hash === judge.hash) return "unchanged";
  await gql(UPDATE_JUDGE, { input: { ...input, datasetEvaluatorId: current.id } });
  return "updated";
}

/**
 * Juiz do recrutador preso ao dataset `narnia-chat` (M5): versionado no Phoenix como os outros; quem roda é o comando
 * de avaliações (as conversas usam as ferramentas, no sandbox isolado).
 */
export async function syncChatJudge(o: {
  baseUrl: string;
  fetch?: FetchLike;
  customProviderId: string | null;
}): Promise<"created" | "updated" | "unchanged" | "sem-dataset"> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const gql: Gql = async <T>(query: string, variables?: unknown): Promise<T> => {
    const r = await f(`${o.baseUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await r.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (!r.ok || body.errors?.length)
      throw new Error(`Phoenix: ${body.errors?.map((e) => e.message).join("; ") ?? r.status}`);
    return body.data as T;
  };
  const r = await f(`${o.baseUrl}/v1/datasets?name=narnia-chat`);
  const ds = ((await r.json()) as { data: Array<{ id: string; name: string }> }).data.find(
    (d) => d.name === "narnia-chat",
  );
  if (!ds) return "sem-dataset";
  const attached =
    (
      await gql<{ node: { datasetEvaluators?: { edges: Array<{ node: Attached }> } } | null }>(
        ATTACHED,
        { id: ds.id },
      )
    ).node?.datasetEvaluators?.edges.map((e) => e.node) ?? [];
  return upsertJudge(gql, ds.id, attached, chatJudge(), o.customProviderId);
}

/** Quantos exemplos cada dataset tem (para a tela). */
export const datasetSizes = () =>
  Object.fromEntries(
    PROMPTS_WITH_EVALUATORS.map((op) => [STRUCTURED_PROMPTS[op].name, PROMPT_DATASETS[op].length]),
  );
