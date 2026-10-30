import { parseEvalCases } from "@narnia-jobs/core";
import { describe, expect, it } from "vitest";
import { buildRunReport, compareRunReports, percentile } from "../src/evals/report";
import { type EvalCaseReport, runEvalCases } from "../src/evals/run";

/**
 * Relatório de execução (F04-fix-fundamentacao, R0, FF-3): por rodada do chat, latência por turno (p50/p95), tokens,
 * custo, tools e buscas por turno, tamanho das respostas, notas e o recall da busca de fatos; cada marco compara com o
 * anterior.
 */
describe("métricas por conversa no runner do chat", () => {
  it("guarda o tempo de cada turno, as tools e as buscas por turno, o tamanho das respostas e o uso", async () => {
    const cases = parseEvalCases(
      '{"id":"um","messages":["oi","e agora?"],"graders":[{"type":"asks_question"}]}',
    );
    let posted = 0;
    const fetchFn = (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const json = (body: unknown) => Promise.resolve(Response.json(body));
      if (path === "/api/sessions" && init?.method === "POST")
        return json({ session: { id: "s1" } });
      if (path.endsWith("/messages") && init?.method === "POST") {
        posted++;
        return json({});
      }
      if (path.endsWith("/messages")) {
        const turns = [
          {
            role: "assistant",
            contentMd: "Achei. Quer ver?",
            toolCalls: [{ name: "fact_search" }, { name: "fact_search" }, { name: "fact_get" }],
          },
          {
            role: "assistant",
            contentMd: "Pronto?",
            toolCalls: [{ name: "x", subagent: true }],
          },
        ].slice(0, posted);
        return json({
          messages: turns.flatMap((t) => [{ role: "user", contentMd: "", toolCalls: [] }, t]),
        });
      }
      if (path === "/api/sessions/s1")
        return json({
          session: { profileId: "p1", tokensIn: 1000, tokensOut: 200, costUsdEst: 0.05 },
        });
      if (path === "/api/research") return json({ sources: [] });
      if (path.endsWith("/hibernate")) return json({});
      return Promise.resolve(new Response("não", { status: 404 }));
    };
    const [r] = await runEvalCases(cases, {
      baseUrl: "http://narnia.test",
      token: "t",
      fetch: fetchFn,
    });
    expect(r?.metrics).toMatchObject({
      toolsPerTurn: [3, 0],
      searchesPerTurn: [2, 0],
      replyChars: [16, 7],
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.05,
    });
    expect(r?.metrics?.turnMs).toHaveLength(2);
  });

  it("o contexto do juiz é lido no fim de cada caso (um caso pode salvar a vaga que o seguinte lê)", async () => {
    const cases = parseEvalCases(
      [
        '{"id":"salva","messages":["salva a vaga"],"graders":[{"type":"asks_question"}]}',
        '{"id":"le","messages":["o que a vaga pede?"],"graders":[{"type":"asks_question"}]}',
      ].join("\n"),
    );
    const saved: string[] = [];
    let n = 0;
    const fetchFn = (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const json = (body: unknown) => Promise.resolve(Response.json(body));
      if (path === "/api/sessions" && init?.method === "POST")
        return json({ session: { id: `s${++n}` } });
      if (path.endsWith("/messages") && init?.method === "POST") {
        // a primeira conversa salva uma vaga no sandbox
        if (n === 1) saved.push("Initech Bank · Backend");
        return json({});
      }
      if (path.endsWith("/messages"))
        return json({ messages: [{ role: "assistant", contentMd: "Ok?", toolCalls: [] }] });
      if (/^\/api\/sessions\/s\d$/.test(path))
        return json({ session: { profileId: "p1", tokensIn: 0, tokensOut: 0, costUsdEst: 0 } });
      if (path === "/api/research") return json({ sources: [] });
      if (path.endsWith("/hibernate")) return json({});
      return Promise.resolve(new Response("não", { status: 404 }));
    };
    const [a, b] = await runEvalCases(cases, {
      baseUrl: "http://narnia.test",
      token: "t",
      fetch: fetchFn,
      savedPostings: () => saved.join("\n"),
    });
    expect(a?.context).toContain("Initech Bank");
    expect(b?.context).toContain("Initech Bank");
  });
});

const caseReport = (id: string, o: Partial<EvalCaseReport> = {}): EvalCaseReport => ({
  id,
  passed: true,
  results: [
    { type: "asks_question", passed: true, detail: "" },
    { type: "cites_source", passed: false, detail: "" },
  ],
  sessionId: "s",
  startedAt: "t",
  endedAt: "t",
  replies: [],
  tools: [],
  judges: [{ name: "padrao_de_entrega", label: "parcial", score: 0.5, explanation: "" }],
  metrics: {
    turnMs: [1000, 3000],
    toolsPerTurn: [2, 4],
    searchesPerTurn: [1, 3],
    replyChars: [500, 1500],
    tokensIn: 1000,
    tokensOut: 100,
    costUsd: 0.1,
  },
  ...o,
});

describe("relatório da rodada", () => {
  it("percentil por interpolação", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
  });

  it("agrega latência, uso, tools, buscas, tamanho, notas e recall; markdown com a tabela", () => {
    const r = buildRunReport({
      label: "r0-base",
      commit: "abc1234",
      at: "2026-10-29T20:00:00.000Z",
      provider: "claude-code",
      samples: [
        [caseReport("a"), (({ metrics: _m, ...rest }) => rest)(caseReport("b", { error: "caiu" }))],
      ],
      recall: { overall: 0.4, byCategory: { exato: 1, agrupado: 0 }, cases: [] },
    });
    expect(r.json.summary).toMatchObject({
      conversations: 2,
      errors: 1,
      turns: 2,
      turnMsP50: 2000,
      toolsPerTurn: 3,
      searchesPerTurn: 2,
      replyCharsAvg: 1000,
      tokensPerConversation: 1100,
      costPerConversation: 0.1,
      graders: 0.5,
      judge: 0.5,
      recall: 0.4,
    });
    expect(r.markdown).toContain("# Relatório r0-base");
    expect(r.markdown).toMatch(/Latência por turno.*p50 2,0 s/);
    expect(r.markdown).toMatch(/agrupado.*0%/);
  });

  it("compara duas rodadas com a diferença de cada métrica", () => {
    const a = buildRunReport({
      label: "antes",
      commit: null,
      at: "t",
      provider: "x",
      samples: [[caseReport("a")]],
    }).json;
    const b = buildRunReport({
      label: "depois",
      commit: null,
      at: "t",
      provider: "x",
      samples: [
        [
          caseReport("a", {
            metrics: {
              ...(caseReport("a").metrics as NonNullable<EvalCaseReport["metrics"]>),
              searchesPerTurn: [1, 1],
            },
          }),
        ],
      ],
    }).json;
    const md = compareRunReports(a, b);
    expect(md).toContain("antes → depois");
    expect(md).toMatch(/Buscas por turno \| 2,0 \| 1,0 \| -1,0/);
  });
});
