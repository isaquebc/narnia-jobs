import { parseEvalCases, seedFixture } from "@narnia-jobs/core";
import { setTracer, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { recordPhoenixExperiment } from "../src/evals/phoenix";
import { runEvalCases } from "../src/evals/run";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/** F04/M5 · runner das avaliações do chat contra a API real (aqui em memória, com o mock). */
describe("F04/M5 · avaliações do chat", () => {
  let t: TestApp | undefined;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
    setTracer(null);
  });

  it("roda os casos pela API, avalia e registra um span por caso no Phoenix, com conversa e anotações", async () => {
    const spans: Array<{ name: string; attrs: Record<string, unknown> }> = [];
    const annotations: Array<{ span: string; names: string[]; note?: string }> = [];
    const impl: TracerImpl = {
      startSpan(name, attrs = {}) {
        const s = { name, attrs: { ...attrs } };
        spans.push(s);
        return {
          spanId: `s${spans.length}`,
          setAttributes: (a) => Object.assign(s.attrs, a),
          recordError: () => undefined,
          end: () => undefined,
        };
      },
      annotate(span, list, note) {
        const owner = spans[Number(span.spanId?.slice(1)) - 1];
        if (owner?.name === "eval.case")
          annotations.push({
            span: String(owner.attrs["narnia.eval.case"]),
            names: list.map((a) => a.name),
            ...(note ? { note } : {}),
          });
      },
    };
    setTracer(impl);
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const app = t.app;
    const cases = parseEvalCases(
      [
        '{"id":"pontos-fracos","messages":["o que está fraco no meu perfil?"],"graders":[{"type":"uses_tool","value":"evidence_experience_list"},{"type":"cites_source"},{"type":"asks_question"},{"type":"no_unknown_years"}]}',
        '{"id":"salario","messages":["qual o salário de mercado para o meu cargo?"],"graders":[{"type":"uses_tool","value":"research_save"},{"type":"asks_confirmation"}]}',
      ].join("\n"),
    );
    const report = await runEvalCases(cases, {
      baseUrl: "http://narnia.test",
      token: TOKEN,
      fetch: (url, init) => Promise.resolve(app.fetch(new Request(url, init))),
      turnTimeoutMs: 5000,
    });
    expect(report.map((r) => [r.id, r.passed])).toEqual([
      ["pontos-fracos", true],
      ["salario", true],
    ]);
    const evalSpans = spans.filter((s) => s.name === "eval.case");
    expect(evalSpans).toHaveLength(2);
    expect(evalSpans[0]?.attrs).toMatchObject({
      "openinference.span.kind": "CHAIN",
      "narnia.eval.case": "pontos-fracos",
      "narnia.eval.passed": true,
      "input.value": "o que está fraco no meu perfil?",
      "session.id": report[0]?.sessionId,
    });
    expect(String(evalSpans[0]?.attrs["output.value"]).length).toBeGreaterThan(0);
    expect(annotations[0]).toEqual({
      span: "pontos-fracos",
      names: ["passed", "uses_tool", "cites_source", "asks_question", "no_unknown_years"],
      note: expect.stringContaining("✔ uses_tool"),
    });
  });

  it("coleta fontes, domínios, uso e tetos da conversa para os avaliadores da auditoria E2 (19b)", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const app = t.app;
    const cases = parseEvalCases(
      '{"id":"salario","messages":["qual o salário de mercado para o meu cargo?"],"graders":[{"type":"trusted_sources_only"},{"type":"within_budget"},{"type":"no_unknown_companies"}]}',
    );
    const [r] = await runEvalCases(cases, {
      baseUrl: "http://narnia.test",
      token: TOKEN,
      fetch: (url, init) => Promise.resolve(app.fetch(new Request(url, init))),
      turnTimeoutMs: 5000,
    });
    expect(r?.error).toBeUndefined();
    expect(r?.results.map((g) => [g.type, g.passed, g.detail])).toEqual([
      ["trusted_sources_only", true, "fontes só de domínio confiável ou confirmadas"],
      ["within_budget", true, "dentro do orçamento e do limite de turnos"],
      ["no_unknown_companies", true, "sem empresas fora do perfil"],
    ]);
    expect(r?.startedAt).toBeTruthy();
    expect(r?.endedAt).toBeTruthy();
  });

  it("registra a rodada como dataset + experimento no Phoenix (REST), com uma avaliação CODE por avaliador", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const phoenix = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init?.method ?? "GET", path: u.pathname + u.search, body });
      const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
      if (u.pathname === "/v1/datasets" && (init?.method ?? "GET") === "GET")
        return ok({ data: [], next_cursor: null });
      if (u.pathname === "/v1/datasets/upload")
        return ok({
          data: {
            dataset_id: "ds1",
            version_id: "v1",
            num_created_examples: 2,
            num_updated_examples: 0,
            num_deleted_examples: 0,
          },
        });
      if (u.pathname === "/v1/datasets/ds1/examples")
        return ok({
          data: {
            dataset_id: "ds1",
            version_id: "v1",
            examples: [
              {
                id: "ex-a",
                input: { id: "a" },
                output: {},
                metadata: {},
                node_id: "n",
                updated_at: "",
              },
              {
                id: "ex-b",
                input: { id: "b" },
                output: {},
                metadata: {},
                node_id: "n",
                updated_at: "",
              },
            ],
          },
        });
      if (u.pathname === "/v1/datasets/ds1/experiments") return ok({ data: { id: "exp1" } });
      if (u.pathname === "/v1/experiments/exp1/runs")
        return ok({ data: { id: `run-${calls.filter((c) => c.path.endsWith("/runs")).length}` } });
      if (u.pathname === "/v1/experiment_evaluations") return ok({ data: { id: "ev" } });
      return new Response("não esperado", { status: 404 });
    };
    const cases = parseEvalCases(
      [
        '{"id":"a","messages":["oi"],"graders":[{"type":"asks_question"},{"type":"cites_source"}]}',
        '{"id":"b","messages":["oi"],"graders":[{"type":"asks_question"}]}',
      ].join("\n"),
    );
    const at = "2026-10-12T12:00:00.000Z";
    const reports = [
      {
        id: "a",
        passed: false,
        sessionId: "s1",
        startedAt: at,
        endedAt: at,
        replies: ["olá?"],
        results: [
          { type: "asks_question" as const, passed: true, detail: "faz pergunta" },
          { type: "cites_source" as const, passed: false, detail: "nenhuma fonte citada" },
        ],
      },
      {
        id: "b",
        passed: false,
        sessionId: "",
        startedAt: at,
        endedAt: at,
        replies: [],
        results: [],
        error: "timeout",
      },
    ];
    const out = await recordPhoenixExperiment(cases, reports, {
      baseUrl: "http://phoenix.test:6006",
      fetch: phoenix,
      name: "chat mock",
      content: false,
    });
    expect(out).toEqual({ datasetId: "ds1", experimentId: "exp1", runs: 2 });
    const upload = calls.find((c) => c.path.startsWith("/v1/datasets/upload"));
    expect(upload?.path).toContain("sync=true");
    expect(upload?.body).toMatchObject({
      action: "create",
      name: "narnia-chat",
      inputs: [{ id: "a" }, { id: "b" }],
    });
    const runs = calls.filter((c) => c.path === "/v1/experiments/exp1/runs");
    expect(runs.map((r) => (r.body as { dataset_example_id: string }).dataset_example_id)).toEqual([
      "ex-a",
      "ex-b",
    ]);
    // sem NARNIA_OTEL_CONTENT=1 as respostas do recrutador não vão para o Phoenix
    expect(JSON.stringify(runs)).not.toContain("olá?");
    expect(runs[1]?.body).toMatchObject({ error: "timeout" });
    const evals = calls.filter((c) => c.path === "/v1/experiment_evaluations");
    expect(
      evals.map(
        (e) => e.body as { name: string; annotator_kind: string; result: { score: number } },
      ),
    ).toEqual([
      expect.objectContaining({
        name: "asks_question",
        annotator_kind: "CODE",
        result: expect.objectContaining({ score: 1, label: "passou" }),
      }),
      expect.objectContaining({
        name: "cites_source",
        result: expect.objectContaining({ score: 0, label: "falhou" }),
      }),
    ]);
  });

  it("dataset que já existe é atualizado (action update) em vez de recriado", async () => {
    const bodies: unknown[] = [];
    const phoenix = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (u.pathname === "/v1/datasets" && (init?.method ?? "GET") === "GET")
        return ok({ data: [{ id: "ds1", name: "narnia-chat" }], next_cursor: null });
      if (u.pathname === "/v1/datasets/upload")
        return ok({ data: { dataset_id: "ds1", version_id: "v2" } });
      if (u.pathname === "/v1/datasets/ds1/examples") return ok({ data: { examples: [] } });
      if (u.pathname === "/v1/datasets/ds1/experiments") return ok({ data: { id: "exp2" } });
      return ok({ data: { id: "x" } });
    };
    const cases = parseEvalCases(
      '{"id":"a","messages":["oi"],"graders":[{"type":"asks_question"}]}',
    );
    await recordPhoenixExperiment(cases, [], {
      baseUrl: "http://p",
      fetch: phoenix,
      name: "n",
      content: false,
    });
    expect(bodies[0]).toMatchObject({ action: "update", name: "narnia-chat" });
  });
});
