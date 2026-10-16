import { STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { syncEvaluators } from "../src/evals/eval-sync";
import { datasetRows, PROMPT_DATASETS } from "../src/evals/prompt-datasets";
import { PROMPTS_WITH_EVALUATORS, promptEvaluators } from "../src/evals/prompt-evaluators";

/** M3: datasets e avaliadores de código no Phoenix, versionados e presos ao dataset de cada prompt. */
function fakePhoenix() {
  const datasets = new Map<string, { id: string; uploads: number }>();
  const evaluators = new Map<string, { id: string; source: string; versions: number }>();
  const attached = new Map<string, Set<string>>();
  const judges = new Map<string, { id: string; hash: string; updates: number }>();
  const calls: Array<{ op: string; input?: Record<string, unknown> }> = [];
  let seq = 0;
  const fetchFn = async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.includes("/v1/datasets/upload")) {
      const name = String(body.name);
      const d = datasets.get(name) ?? { id: `D${++seq}`, uploads: 0 };
      d.uploads++;
      datasets.set(name, d);
      calls.push({ op: `upload:${body.action}`, input: body });
      return Response.json({ data: { dataset_id: d.id } });
    }
    if (url.includes("/v1/datasets?name=")) {
      const name = decodeURIComponent(url.split("name=")[1] ?? "");
      const d = datasets.get(name);
      return Response.json({ data: d ? [{ id: d.id, name }] : [] });
    }
    const q = String(body.query);
    const input = (body.variables as { input?: Record<string, unknown> } | undefined)?.input ?? {};
    if (q.includes("sandboxProviders"))
      return Response.json({
        data: {
          sandboxProviders: [
            {
              backendType: "DENO",
              configs: [{ id: "SB1", name: "default-deno-typescript", language: "TYPESCRIPT" }],
            },
          ],
        },
      });
    if (q.includes("createCodeEvaluatorVersion")) {
      const e = [...evaluators.values()].find((x) => x.id === input.codeEvaluatorId);
      if (e) {
        e.source = String(input.sourceCode);
        e.versions++;
      }
      calls.push({ op: "version", input });
      return Response.json({ data: { createCodeEvaluatorVersion: { __typename: "x" } } });
    }
    if (q.includes("createCodeEvaluator")) {
      const id = `E${++seq}`;
      evaluators.set(String(input.name), { id, source: String(input.sourceCode), versions: 1 });
      calls.push({ op: "evaluator", input });
      return Response.json({ data: { createCodeEvaluator: { evaluator: { id } } } });
    }
    if (q.includes("createDatasetCodeEvaluator")) {
      const set = attached.get(String(input.datasetId)) ?? new Set<string>();
      set.add(String(input.name));
      attached.set(String(input.datasetId), set);
      calls.push({ op: "attach", input });
      return Response.json({ data: { createDatasetCodeEvaluator: { __typename: "x" } } });
    }
    if (q.includes("createDatasetLlmEvaluator") || q.includes("updateDatasetLlmEvaluator")) {
      const pv = input.promptVersion as { metadata: { hash: string } };
      const key = String(input.datasetId);
      const j = judges.get(key) ?? { id: `J${++seq}`, hash: "", updates: -1 };
      j.hash = pv.metadata.hash;
      j.updates++;
      judges.set(key, j);
      calls.push({ op: q.includes("createDataset") ? "judge" : "judge-update", input });
      return Response.json({ data: { x: { __typename: "x" } } });
    }
    if (q.includes("datasetEvaluators")) {
      const id = String((body.variables as { id: string }).id);
      const j = judges.get(id);
      const code = [...(attached.get(id) ?? [])].map((name) => ({
        node: { id: `DE-${name}`, name, evaluator: {} },
      }));
      const judge = j
        ? [
            {
              node: {
                id: j.id,
                name: "padrao_de_entrega",
                evaluator: { promptVersion: { metadata: { hash: j.hash } } },
              },
            },
          ]
        : [];
      return Response.json({
        data: { node: { datasetEvaluators: { edges: [...code, ...judge] } } },
      });
    }
    // lista de avaliadores
    return Response.json({
      data: {
        evaluators: {
          edges: [...evaluators.entries()].map(([name, e]) => ({
            node: { id: e.id, name, sourceCode: e.source },
          })),
        },
      },
    });
  };
  return { fetch: fetchFn, calls, datasets, evaluators, attached, judges };
}

describe("sincronização de datasets e avaliadores", () => {
  const total = PROMPTS_WITH_EVALUATORS.reduce((n, op) => n + promptEvaluators(op).length, 0);

  it("cria um dataset por prompt, os avaliadores (TypeScript, sandbox Deno) e prende cada um ao dataset", async () => {
    const px = fakePhoenix();
    const r = await syncEvaluators({
      baseUrl: "http://phoenix:6006",
      fetch: px.fetch,
      customProviderId: "CP1",
    });
    expect(px.datasets.size).toBe(15);
    expect(px.evaluators.size).toBe(total);
    expect(r).toEqual({
      datasets: 15,
      evaluatorsCreated: total,
      evaluatorsUpdated: 0,
      attached: total,
      judgesCreated: 15,
      judgesUpdated: 0,
    });
    const judge = px.calls.find((c) => c.op === "judge");
    expect(judge?.input).toMatchObject({
      name: "padrao_de_entrega",
      inputMapping: { pathMapping: { resposta: "output.messages[0].content" } },
      promptVersion: { customProviderId: "CP1" },
      outputConfigs: [{ categorical: { name: "padrao_de_entrega" } }],
    });
    const upload = px.calls.find(
      (c) => c.op === "upload:create" && c.input?.name === "narnia-extract-facts",
    );
    expect(upload?.input?.inputs).toEqual(datasetRows("extractFacts").map((x) => x.input));
    expect(((upload?.input?.inputs ?? []) as unknown[]).length).toBe(
      PROMPT_DATASETS.extractFacts.length,
    );
    const ev = px.calls.find(
      (c) => c.op === "evaluator" && c.input?.name === "narnia-extract-facts-json-schema",
    );
    expect(ev?.input).toMatchObject({
      language: "TYPESCRIPT",
      sandboxConfigId: "SB1",
      inputMapping: { pathMapping: { output: "output", input: "input" } },
    });
    const at = px.calls.find((c) => c.op === "attach" && c.input?.name === "json_schema");
    expect(at?.input).toMatchObject({
      inputMapping: {
        pathMapping: {
          output: "output",
          input: "input",
          reference: "reference",
          metadata: "metadata",
        },
      },
      outputConfigs: [
        {
          continuous: {
            name: "json_schema",
            optimizationDirection: "MAXIMIZE",
            lowerBound: 0,
            upperBound: 1,
          },
        },
      ],
    });
    expect(STRUCTURED_PROMPTS.extractFacts.name).toBe("narnia-extract-facts");
  });

  it("segunda vez: datasets atualizados, nada criado; avaliador com fonte nova vira versão nova", async () => {
    const px = fakePhoenix();
    await syncEvaluators({
      baseUrl: "http://phoenix:6006",
      fetch: px.fetch,
      customProviderId: null,
    });
    const again = await syncEvaluators({
      baseUrl: "http://phoenix:6006",
      fetch: px.fetch,
      customProviderId: null,
    });
    expect(again).toEqual({
      datasets: 15,
      evaluatorsCreated: 0,
      evaluatorsUpdated: 0,
      attached: 0,
      judgesCreated: 0,
      judgesUpdated: 0,
    });
    // texto do juiz mudou (hash diferente no Phoenix): versão nova pelo update
    const first = [...px.judges.values()][0];
    if (first) first.hash = "antigo";
    const changed = await syncEvaluators({
      baseUrl: "http://phoenix:6006",
      fetch: px.fetch,
      customProviderId: null,
    });
    expect(changed.judgesUpdated).toBe(1);
    expect(px.calls.filter((c) => c.op === "upload:update")).toHaveLength(30);
    const e = px.evaluators.get("narnia-check-proposals-json-schema");
    if (e) e.source = "// versão antiga";
    const third = await syncEvaluators({
      baseUrl: "http://phoenix:6006",
      fetch: px.fetch,
      customProviderId: null,
    });
    expect(third.evaluatorsUpdated).toBe(1);
    expect(px.evaluators.get("narnia-check-proposals-json-schema")?.versions).toBe(2);
  });
});
