import { parseEvalCases, seedFixture } from "@narnia-jobs/core";
import { setTracer, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
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

  it("roda os casos pela API, avalia e registra um span por caso no Phoenix", async () => {
    const spans: Array<{ name: string; attrs: Record<string, unknown> }> = [];
    const impl: TracerImpl = {
      startSpan(name, attrs = {}) {
        const s = { name, attrs: { ...attrs } };
        spans.push(s);
        return {
          setAttributes: (a) => Object.assign(s.attrs, a),
          recordError: () => undefined,
          end: () => undefined,
        };
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
      "narnia.eval.case": "pontos-fracos",
      "narnia.eval.passed": true,
    });
  });
});
