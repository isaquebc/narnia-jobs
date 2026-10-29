import { describe, expect, it } from "vitest";
import { parseMultipart, runPromptExperiment } from "../src/evals/phoenix-run";
import { promptCatalog } from "../src/evals/prompt-catalog";

/** M5: roda um prompt estruturado sobre o dataset dele como experimento do Phoenix (o mesmo que o Playground). */
const part = (payload: unknown) =>
  `\r\n--graphql\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ payload: { data: { chatCompletionOverDataset: payload } } })}`;

const MULTIPART =
  part({ __typename: "ChatCompletionSubscriptionExperiment", experiment: { id: "X1" } }) +
  part({ __typename: "TextChunk", content: "{" }) +
  part({
    __typename: "ChatCompletionSubscriptionResult",
    datasetExampleId: "e1",
    experimentRun: { id: "R1", output: { messages: [{ role: "assistant", content: "{}" }] } },
  }) +
  part({
    __typename: "EvaluationChunk",
    datasetExampleId: "e1",
    evaluatorName: "json_schema",
    error: null,
    experimentRunEvaluation: { name: "json_schema", label: "passou", score: 1, explanation: "ok" },
  }) +
  part({
    __typename: "EvaluationChunk",
    datasetExampleId: "e1",
    evaluatorName: "padrao_de_entrega",
    error: null,
    experimentRunEvaluation: {
      name: "padrao_de_entrega",
      label: "parcial",
      score: 0.5,
      explanation: "faltou a formação",
    },
  }) +
  part({
    __typename: "ChatCompletionSubscriptionError",
    datasetExampleId: "e2",
    message: "Limite da assinatura",
  }) +
  part({
    __typename: "EvaluationChunk",
    datasetExampleId: "e2",
    evaluatorName: "json_schema",
    error: "sem saída",
    experimentRunEvaluation: null,
  }) +
  "\r\n--graphql--\r\n";

describe("experimento de prompt no Phoenix", () => {
  it("parseMultipart extrai as partes JSON da resposta multipart do Phoenix", () => {
    const parts = parseMultipart(MULTIPART);
    expect(parts.map((p) => (p as { __typename: string }).__typename)).toEqual([
      "ChatCompletionSubscriptionExperiment",
      "TextChunk",
      "ChatCompletionSubscriptionResult",
      "EvaluationChunk",
      "EvaluationChunk",
      "ChatCompletionSubscriptionError",
      "EvaluationChunk",
    ]);
  });

  it("monta o pedido com a versão production, o dataset e os avaliadores presos; resume notas por avaliador", async () => {
    const def = promptCatalog().find((p) => p.name === "narnia-extract-facts");
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      seen.push({ url, body });
      if (url.endsWith("/tags/production")) return Response.json({ data: { id: "PV9" } });
      if (url.includes("/v1/datasets?name="))
        return Response.json({ data: [{ id: "D1", name: "narnia-extract-facts" }] });
      if (url.endsWith("/v1/datasets/D1/examples"))
        return Response.json({
          data: {
            examples: [
              { id: "e1", input: { id: "cv-completo" } },
              { id: "e2", input: { id: "cv-ingles" } },
            ],
          },
        });
      const q = String(body.query);
      if (q.includes("datasetEvaluators"))
        return Response.json({
          data: {
            node: {
              datasetEvaluators: {
                edges: [
                  {
                    node: {
                      id: "DE1",
                      name: "json_schema",
                      inputMapping: { pathMapping: { output: "output" }, literalMapping: {} },
                    },
                  },
                ],
              },
            },
          },
        });
      return new Response(MULTIPART, {
        headers: { "content-type": "multipart/mixed;boundary=graphql" },
      });
    };
    const r = await runPromptExperiment(def as never, {
      baseUrl: "http://px",
      fetch: fetchFn,
      customProviderId: "CP1",
    });
    const sub = seen.find((s) => String(s.body.query).includes("chatCompletionOverDataset"));
    const input = ((sub?.body.variables ?? {}) as { i?: Record<string, unknown> }).i;
    expect(input).toMatchObject({
      promptVersionId: "PV9",
      datasetId: "D1",
      repetitions: 1,
      templateVariablesPath: "input",
      promptVersion: { customProviderId: "CP1", modelName: "claude-haiku-4-5" },
      evaluators: [
        { id: "DE1", name: "json_schema", inputMapping: { pathMapping: { output: "output" } } },
      ],
    });
    const completo = {
      runId: "R1",
      output: { messages: [{ role: "assistant", content: "{}" }] },
      evaluations: [
        { name: "json_schema", kind: "CODE", label: "passou", score: 1, explanation: "ok" },
        {
          name: "padrao_de_entrega",
          kind: "LLM",
          label: "parcial",
          score: 0.5,
          explanation: "faltou a formação",
        },
      ],
    };
    const ingles = { runId: null, output: null, evaluations: [], error: "Limite da assinatura" };
    expect(r).toEqual({
      name: "narnia-extract-facts",
      experimentId: "X1",
      runs: 1,
      errors: ["cv-ingles: Limite da assinatura"],
      scores: {
        json_schema: { mean: 1, n: 1, failed: [] },
        padrao_de_entrega: { mean: 0.5, n: 1, failed: ["cv-completo: faltou a formação"] },
      },
      evaluatorErrors: ["json_schema (cv-ingles): sem saída"],
      // M7: saída e notas por exemplo, para o pairwise e a versão aprovada; todas as repetições em samples
      examples: [
        {
          exampleId: "cv-completo",
          ...completo,
          samples: [{ repetition: 1, ...completo }],
        },
        {
          exampleId: "cv-ingles",
          ...ingles,
          samples: [{ repetition: 1, ...ingles }],
        },
      ],
    });
  });
});
