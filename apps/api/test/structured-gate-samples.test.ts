import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ApprovedCase, serializeApproved } from "@narnia-jobs/core";
import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { BaselineGate } from "../src/evals/baseline-file";
import { openCheckpoint } from "../src/evals/checkpoint";
import { judgeFor } from "../src/evals/judges";
import {
  approvedPromptVersion,
  mergeRepetitions,
  type PromptExperimentResult,
  type PromptSample,
  runPromptExperiment,
} from "../src/evals/phoenix-run";
import { promptCatalog } from "../src/evals/prompt-catalog";
import {
  featureResults,
  promptGatePlan,
  promptPairRuns,
  repetitionSpread,
  splitRepetitions,
} from "../src/evals/prompt-gate";

/**
 * Gate dos prompts estruturados com amostras, ruído e não-inferioridade (pedido do dono, 2026-10-29): a regra das
 * etapas no `posting.extract` reprovou com uma amostra só por caso (as 3 derrotas foram em campos sem relação), e o
 * runner não tinha `--feature`. Agora o gate dos estruturados repete cada caso (`repetitions` do Phoenix), roda a
 * versão aprovada do lado A (pelo histórico de versões do Phoenix) e mede o ruído (A contra A) por prompt.
 */
const part = (payload: unknown) =>
  `\r\n--graphql\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ payload: { data: { chatCompletionOverDataset: payload } } })}`;
const result = (ex: string, rep: number, content: string) =>
  part({
    __typename: "ChatCompletionSubscriptionResult",
    datasetExampleId: ex,
    repetitionNumber: rep,
    experimentRun: { id: `R-${ex}-${rep}`, output: content },
  });
const evaluation = (ex: string, rep: number, name: string, score: number) =>
  part({
    __typename: "EvaluationChunk",
    datasetExampleId: ex,
    repetitionNumber: rep,
    evaluatorName: name,
    error: null,
    experimentRunEvaluation: { name, label: String(score), score, explanation: `${ex}#${rep}` },
  });

const ev = (name: string, score: number, kind: "CODE" | "LLM" = "CODE") => ({
  name,
  kind,
  label: String(score),
  score,
  explanation: "",
});
const sample = (
  repetition: number,
  output: unknown,
  scores: Record<string, number> = {},
): PromptSample => ({
  repetition,
  runId: `R${repetition}`,
  output,
  evaluations: Object.entries(scores).map(([n, s]) =>
    ev(n, s, n === "padrao_de_entrega" ? "LLM" : "CODE"),
  ),
});
const example = (exampleId: string, samples: PromptSample[]) => ({
  exampleId,
  runId: samples[0]?.runId ?? null,
  output: samples[0]?.output ?? null,
  evaluations: samples[0]?.evaluations ?? [],
  samples,
});

function phoenix(multipart: string, seen: Array<{ url: string; body: Record<string, unknown> }>) {
  return async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    seen.push({ url, body });
    if (url.endsWith("/tags/production")) return Response.json({ data: { id: "PV-PROD" } });
    if (url.includes("/v1/datasets?name="))
      return Response.json({ data: [{ id: "D1", name: "narnia-posting-extract" }] });
    if (url.endsWith("/v1/datasets/D1/examples"))
      return Response.json({
        data: {
          examples: [
            { id: "e1", input: { id: "consultoria" } },
            { id: "e2", input: { id: "minima" } },
          ],
        },
      });
    if (String(body.query).includes("datasetEvaluators"))
      return Response.json({ data: { node: { datasetEvaluators: { edges: [] } } } });
    return new Response(multipart, {
      headers: { "content-type": "multipart/mixed;boundary=graphql" },
    });
  };
}

describe("experimento com repetições e versão aprovada", () => {
  const def = promptCatalog().find((p) => p.name === "narnia-posting-extract");

  it("pede N repetições e agrupa as amostras de cada exemplo pela repetição", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const multipart =
      part({ __typename: "ChatCompletionSubscriptionExperiment", experiment: { id: "X1" } }) +
      result("e1", 2, "b") +
      result("e1", 1, "a") +
      evaluation("e1", 2, "json_schema", 0) +
      evaluation("e1", 1, "json_schema", 1) +
      result("e2", 1, "c") +
      part({
        __typename: "ChatCompletionSubscriptionError",
        datasetExampleId: "e2",
        repetitionNumber: 2,
        message: "You've hit your usage limit",
      }) +
      "\r\n--graphql--\r\n";
    const r = await runPromptExperiment(def as never, {
      baseUrl: "http://px",
      fetch: phoenix(multipart, seen),
      customProviderId: null,
      repetitions: 2,
    });
    const sub = seen.find((s) => String(s.body.query).includes("chatCompletionOverDataset"));
    expect((sub?.body.variables as { i?: { repetitions?: number } })?.i?.repetitions).toBe(2);
    expect(r.errors).toEqual(["minima (repetição 2): You've hit your usage limit"]);
    expect(r.scores.json_schema).toMatchObject({ mean: 0.5, n: 2 });
    const consultoria = r.examples.find((e) => e.exampleId === "consultoria");
    // a primeira repetição continua no topo (pairwise, aprovada, Phoenix)
    expect(consultoria).toMatchObject({ runId: "R-e1-1", output: "a" });
    expect(
      consultoria?.samples.map((s) => [s.repetition, s.output, s.evaluations[0]?.score]),
    ).toEqual([
      [1, "a", 1],
      [2, "b", 0],
    ]);
    const minima = r.examples.find((e) => e.exampleId === "minima");
    expect(minima?.samples.map((s) => [s.repetition, s.error ?? null])).toEqual([
      [1, null],
      [2, "You've hit your usage limit"],
    ]);
  });

  it("roda a versão aprovada no lugar da production quando pedida", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const approved = { ...(def as NonNullable<typeof def>), hash: "h-aprovada" };
    await runPromptExperiment(def as never, {
      baseUrl: "http://px",
      fetch: phoenix("\r\n--graphql--\r\n", seen),
      customProviderId: null,
      version: { id: "PV-OLD", def: approved },
    });
    const sub = seen.find((s) => String(s.body.query).includes("chatCompletionOverDataset"));
    const input = (sub?.body.variables as { i?: Record<string, unknown> })?.i ?? {};
    expect(input.promptVersionId).toBe("PV-OLD");
    expect(input.promptVersion).toMatchObject({ metadata: { hash: "h-aprovada" } });
    expect(String(input.experimentName)).toContain("aprovada");
    expect(seen.some((s) => s.url.endsWith("/tags/production"))).toBe(false);
  });

  it("acha a versão aprovada no histórico do Phoenix pelo hash e a converte em prompt", async () => {
    const versions = {
      data: [
        { id: "PV-NEW", metadata: { hash: "novo" } },
        {
          id: "PV-OLD",
          metadata: { hash: "velho" },
          model_name: "claude-haiku-4-5",
          template: {
            type: "chat",
            messages: [
              { role: "system", content: [{ type: "text", text: "regras antigas" }] },
              { role: "user", content: [{ type: "text", text: "{{text}}" }] },
            ],
          },
          response_format: {
            type: "json_schema",
            json_schema: { name: "posting_extract", schema: { type: "object" } },
          },
        },
      ],
    };
    const fetchFn = async (url: string) =>
      url.endsWith("/v1/prompts/narnia-posting-extract/versions")
        ? Response.json(versions)
        : new Response("não", { status: 404 });
    const found = await approvedPromptVersion(def as never, "velho", {
      baseUrl: "http://px",
      fetch: fetchFn,
    });
    expect(found?.id).toBe("PV-OLD");
    expect(found?.def).toMatchObject({
      name: "narnia-posting-extract",
      hash: "velho",
      modelName: "claude-haiku-4-5",
      messages: [
        { role: "SYSTEM", content: "regras antigas" },
        { role: "USER", content: "{{text}}" },
      ],
      jsonSchema: { type: "object" },
      schemaName: "posting_extract",
    });
    expect(
      await approvedPromptVersion(def as never, "sumiu", { baseUrl: "http://px", fetch: fetchFn }),
    ).toBeNull();
  });
});

describe("repetições em experimentos seguidos", () => {
  // a ponte atende 2 chamadas e enfileira 8: 6 repetições de uma vez voltavam "rate limit" (2026-10-29)
  it("junta experimentos de uma repetição: amostras numeradas, notas pela média de todas, erros com a repetição", () => {
    const one = (
      id: string,
      output: string,
      score: number,
      errors: string[] = [],
    ): PromptExperimentResult => ({
      name: "narnia-x",
      experimentId: id,
      runs: 1,
      errors,
      scores: {
        json_schema: { mean: score, n: 1, failed: score < 1 ? [`a: ruim ${id}`] : [] },
      },
      evaluatorErrors: [],
      examples: [example("a", [sample(1, output, { json_schema: score })])],
    });
    const r = mergeRepetitions([one("X1", "a1", 1), one("X2", "a2", 0, ["a: caiu"])]);
    expect(r).toMatchObject({ experimentId: "X1", runs: 2, errors: ["a: caiu (repetição 2)"] });
    expect(r.scores.json_schema).toEqual({ mean: 0.5, n: 2, failed: ["a: ruim X2 (repetição 2)"] });
    expect(r.examples[0]).toMatchObject({ exampleId: "a", output: "a1" });
    expect(r.examples[0]?.samples.map((s) => [s.repetition, s.output])).toEqual([
      [1, "a1"],
      [2, "a2"],
    ]);
  });
});

describe("plano do gate por prompt estruturado", () => {
  const approved = (versionId: string, ...ids: string[]): ApprovedCase[] =>
    ids.map((exampleId) => ({
      exampleId,
      versionId,
      commit: "c1",
      approvedAt: "2026-10-28T00:00:00Z",
      output: null,
      evaluations: [],
    }));
  const flags = (o: Record<string, unknown> = {}) => ({
    gate: false,
    update: false,
    fixes: [],
    ...o,
  });
  const ids = ["a", "b", "novo"];

  it("sem --gate: uma rodada só", () => {
    expect(
      promptGatePlan({
        flags: flags(),
        hash: "v2",
        approved: approved("v1", "a"),
        exampleIds: ids,
      }),
    ).toMatchObject({ mode: "single", repetitions: 1, approvedSide: false });
  });

  it("prompt que mudou no gate: 5 amostras dos dois lados (--samples muda)", () => {
    expect(
      promptGatePlan({
        flags: flags({ gate: true }),
        hash: "v2",
        approved: approved("v1", "a", "b"),
        exampleIds: ids,
      }),
    ).toMatchObject({ mode: "compare", repetitions: 5, approvedSide: true, feature: [] });
    expect(
      promptGatePlan({
        flags: flags({ update: true, samples: 3 }),
        hash: "v2",
        approved: approved("v1", "a"),
        exampleIds: ids,
      }).repetitions,
    ).toBe(3);
  });

  it("prompt igual à aprovada no gate: uma rodada, sem lado A", () => {
    expect(
      promptGatePlan({
        flags: flags({ gate: true }),
        hash: "v1",
        approved: approved("v1", "a"),
        exampleIds: ids,
      }),
    ).toMatchObject({ mode: "single", repetitions: 1, approvedSide: false });
  });

  it("--feature vale só para os casos do dataset do prompt", () => {
    const f = flags({ gate: true, feature: ["novo", "de-outro-prompt"] });
    expect(
      promptGatePlan({ flags: f, hash: "v2", approved: approved("v1", "a"), exampleIds: ids }),
    ).toMatchObject({ mode: "compare", feature: ["novo"] });
    expect(
      promptGatePlan({ flags: f, hash: "v1", approved: approved("v1", "a"), exampleIds: ["a"] }),
    ).toMatchObject({ mode: "single", feature: [] });
  });

  it("--noise: só prompt igual à aprovada, com 2N repetições (metade de cada lado; N = 3)", () => {
    const f = flags({ noise: true });
    expect(
      promptGatePlan({ flags: f, hash: "v1", approved: approved("v1", "a"), exampleIds: ids }),
    ).toMatchObject({ mode: "noise", repetitions: 6, approvedSide: false });
    expect(
      promptGatePlan({ flags: f, hash: "v2", approved: approved("v1", "a"), exampleIds: ids }),
    ).toMatchObject({ mode: "skip" });
    expect(promptGatePlan({ flags: f, hash: "v1", approved: [], exampleIds: ids }).mode).toBe(
      "skip",
    );
  });
});

describe("amostras do experimento no gate", () => {
  const rows = new Map([
    ["a", { input: { text: "vaga a" }, output: { expected: ["x"] }, metadata: { id: "a" } }],
    ["b", { input: { text: "vaga b" }, output: {}, metadata: { id: "b" } }],
  ]);

  it("pares do pairwise: primeira amostra, as extras e o lado A pareado", () => {
    const cand = [
      example("a", [sample(1, "a1"), sample(2, "a2")]),
      example("b", [sample(1, "b1"), { ...sample(2, null), error: "falhou" }]),
    ];
    const against = [example("a", [sample(1, "A1"), sample(2, "A2")])];
    const runs = promptPairRuns(cand, rows, against);
    expect(runs[0]).toMatchObject({
      exampleId: "a",
      ctx: { input: { text: "vaga a" }, reference: { expected: ["x"] } },
      output: "a1",
      samples: ["a2"],
      against: ["A1", "A2"],
    });
    expect(runs[0]?.error).toBeUndefined();
    expect(runs[1]).toMatchObject({ exampleId: "b", error: "falhou" });
    expect(runs[1]?.against).toBeUndefined();
  });

  it("--noise: as repetições 1..N são a candidata e N+1..2N o lado A", () => {
    const all = [
      example(
        "a",
        [1, 2, 3, 4].map((k) => sample(k, `a${k}`)),
      ),
    ];
    const { candidate, against } = splitRepetitions(all, 2);
    expect(candidate[0]?.samples.map((s) => s.output)).toEqual(["a1", "a2"]);
    expect(candidate[0]?.output).toBe("a1");
    expect(against[0]?.samples.map((s) => s.output)).toEqual(["a3", "a4"]);
  });

  it("caso novo passa se a maioria das amostras passa nos avaliadores de código e o juiz não reprova", () => {
    const ok = { json_schema: 1, cobertura_da_referencia: 1, padrao_de_entrega: 0.5 };
    const cand = [
      example("novo", [
        sample(1, "x", ok),
        sample(2, "y", { ...ok, cobertura_da_referencia: 0.7 }),
        sample(3, "z", ok),
      ]),
      example("ruim", [
        sample(1, "x", { ...ok, padrao_de_entrega: 0 }),
        sample(2, "y", ok),
        { ...sample(3, null), error: "erro" },
      ]),
    ];
    expect(featureResults(cand, ["novo", "ruim", "ausente"])).toEqual([
      {
        exampleId: "novo",
        passed: true,
        detail: "2 de 3 amostras passaram nos avaliadores e no juiz",
      },
      {
        exampleId: "ruim",
        passed: false,
        detail: "1 de 3 amostras passaram nos avaliadores e no juiz",
      },
    ]);
  });

  it("variação da nota entre as repetições: o maior intervalo entre as médias por avaliador", () => {
    const cand = [
      example("a", [sample(1, "", { j: 1, k: 1 }), sample(2, "", { j: 0.5, k: 1 })]),
      example("b", [sample(1, "", { j: 1, k: 0 }), sample(2, "", { j: 1, k: 1 })]),
    ];
    // j: 1 e 0.75 → 0.25; k: 0.5 e 1 → 0.5
    expect(repetitionSpread(cand)).toBeCloseTo(0.5);
  });
});

describe("gate dos estruturados · ruído e --feature por prompt", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const judge = judgeFor("chatTitle");
  const out = (content: string) => ({ messages: [{ role: "assistant", content }] });
  const tie = {
    complete: async (_: CompleteInput): Promise<CompleteResult> => ({
      text: "",
      structured: { vencedor: "empate", explicacao: "" },
      model: "m",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "m",
      },
      costUsd: 0,
    }),
  };
  function setup(key: string, approved: ApprovedCase[]) {
    const d = mkdtempSync(join(tmpdir(), "narnia-estruturados-"));
    dirs.push(d);
    mkdirSync(join(d, "approved"));
    writeFileSync(join(d, "approved", `${key}.jsonl`), serializeApproved(approved));
    return join(d, "baselines.json");
  }
  const approvedCase = (exampleId: string, versionId: string): ApprovedCase => ({
    exampleId,
    versionId,
    commit: "c1",
    approvedAt: "2026-10-28T00:00:00Z",
    output: out(`aprovada ${exampleId}`),
    evaluations: [],
  });
  const pairRun = (exampleId: string, ...texts: string[]) => ({
    exampleId,
    ctx: { input: { message: `msg-${exampleId}` } },
    output: out(texts[0] ?? ""),
    evaluations: [],
    samples: texts.slice(1).map(out),
  });

  it("A contra A sem dependências por caso: vale a versão do prompt", async () => {
    const path = setup("narnia-chat-title", [approvedCase("a", "v1"), approvedCase("b", "v1")]);
    const g = new BaselineGate({ gate: false, update: false, fixes: [], noise: true }, path);
    const noise = await g.measureNoise("narnia-chat-title", {
      judge,
      provider: tie,
      versionId: "v1",
      runs: [pairRun("a", "x", "y"), pairRun("b", "x", "y")],
      spreads: { "narnia-chat-title": 0.1 },
    });
    expect(noise).toMatchObject({ cases: 2, samples: 2, pairs: 4, decisiveRate: 0 });
    g.finish(() => {});
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved["ruido:narnia-chat-title"].scores).toMatchObject({
      "narnia-chat-title": 0.1,
      decisivos_por_amostra: 0,
    });
  });

  it("--feature de outro prompt não reprova este; o prompt que mudou sem caso novo continua upgrade", async () => {
    const path = setup("narnia-chat-title", [approvedCase("a", "v1")]);
    const g = new BaselineGate(
      { gate: true, update: false, fixes: [], feature: ["etapas-em-prosa"] },
      path,
    );
    const cmp = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: null,
      judge,
      provider: tie,
      runs: [pairRun("a", "x")],
      feature: [],
    });
    // sem caso novo deste prompt: o critério é upgrade, e só empates não bastam
    expect(cmp.decision?.reason).not.toMatch(/não rodou/);
    expect(cmp.decision?.passed).toBe(false);
  });
});

describe("tolerância das médias com N amostras (2026-10-29)", () => {
  // o ruído mede a variação da média de UMA repetição; o gate compara a média de N: a tolerância cai com √N (com 1–2
  // casos, uma nota "parcial" do juiz movia a média de uma repetição em 50 pontos, e a tolerância deixava passar tudo)
  it("divide a variação medida por √N, sem ficar abaixo do piso de 5 pontos", () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-tol-"));
    try {
      const path = join(dir, "baselines.json");
      writeFileSync(
        path,
        JSON.stringify({
          "narnia-build-digest": { scores: { padrao_de_entrega: 1 }, updatedAt: "t" },
          "ruido:narnia-build-digest": { scores: { "narnia-build-digest": 0.5 }, updatedAt: "t" },
        }),
      );
      const g = new BaselineGate({ gate: true, update: false, fixes: [] }, path);
      // 1 amostra: tolerância de 50 pontos
      expect(g.record("narnia-build-digest", { padrao_de_entrega: 0.6 })).toEqual([]);
      // 4 amostras: 50 / √4 = 25 pontos
      expect(g.record("narnia-build-digest", { padrao_de_entrega: 0.8 }, { samples: 4 })).toEqual(
        [],
      );
      expect(
        g.record("narnia-build-digest", { padrao_de_entrega: 0.7 }, { samples: 4 }),
      ).toHaveLength(1);
      // 10 000 amostras: o piso de 5 pontos
      expect(
        g.record("narnia-build-digest", { padrao_de_entrega: 0.96 }, { samples: 10_000 }),
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("retomada do gate dos estruturados", () => {
  it("guarda o experimento terminado por chave e devolve ao reabrir", () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-cp-"));
    try {
      const path = join(dir, "prompts.json");
      openCheckpoint(path, "k").putValue("narnia-posting-extract:candidata", { runs: 3 });
      expect(openCheckpoint(path, "k").getValue("narnia-posting-extract:candidata")).toEqual({
        runs: 3,
      });
      expect(openCheckpoint(path, "k").resumed.values).toBe(1);
      expect(
        openCheckpoint(path, "outra").getValue("narnia-posting-extract:candidata"),
      ).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
