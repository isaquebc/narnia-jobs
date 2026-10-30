import type { CompleteInput } from "@narnia-jobs/providers";
import { MockProvider } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { chatJudge, judgeFor } from "../src/evals/judges";
import { judgeLocally, recordLocalExperiment, resolvePath } from "../src/evals/local-eval";

/**
 * M5: o que roda fora do Playground (recrutador no sandbox, leitura de PDF) usa o mesmo juiz (texto e variáveis) pela
 * assinatura e grava o experimento no Phoenix com as avaliações.
 */
describe("avaliação local", () => {
  it("resolvePath segue o caminho do contexto do Phoenix (pontos e índices)", () => {
    const ctx = { output: { messages: [{ content: "oi" }] }, input: { text: "t" } };
    expect(resolvePath(ctx, "output.messages[0].content")).toBe("oi");
    expect(resolvePath(ctx, "input.text")).toBe("t");
    expect(resolvePath(ctx, "reference")).toBeUndefined();
  });

  it("juiz do recrutador: arquivo próprio e variáveis do dataset do chat", () => {
    const j = chatJudge();
    expect(j.file).toBe("evals/judges/narnia-recrutador.md");
    // F06-8: o juiz recebe o system prompt do recrutador (cartões de todos os perfis) como contexto
    expect(j.variables).toEqual({
      contexto: "input.context",
      conversa: "input.messages",
      respostas: "output.replies",
      ferramentas: "output.tools",
    });
    expect(j.body).toContain("{{conversa}}");
    expect(j.body).toContain("{{contexto}}");
  });

  it("judgeLocally renderiza o texto do juiz com o contexto e pede a classificação como saída estruturada", async () => {
    const seen: CompleteInput[] = [];
    const provider = new MockProvider();
    const spy = {
      complete: (i: CompleteInput) => {
        seen.push(i);
        return provider.complete(i);
      },
    };
    // o juiz do recrutador virou perguntas (judge-checklist.test.ts); o rótulo único continua nos estruturados
    const r = await judgeLocally(spy, judgeFor("chatTitle"), {
      input: { message: "o que está fraco no meu perfil?" },
      output: { messages: [{ role: "assistant", content: "Faltam métricas na Acme." }] },
    });
    expect(r).toEqual({
      name: "padrao_de_entrega",
      label: "atende",
      score: 1,
      explanation: "exemplo",
    });
    expect(seen[0]?.prompt).toContain("o que está fraco no meu perfil?");
    expect(seen[0]?.prompt).toContain("Faltam métricas na Acme.");
    expect(seen[0]?.prompt).not.toContain("{{");
    expect(seen[0]?.jsonSchema).toMatchObject({
      properties: { label: { enum: ["atende", "parcial", "nao_atende"] } },
      required: ["label", "explanation"],
    });
    expect(judgeFor("readDocument").variables.resposta).toBe("output.messages[0].content");
  });

  it("recordLocalExperiment cria o experimento no dataset, uma execução por exemplo e as avaliações", async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push({ url, body });
        if (url.endsWith("/experiments")) return Response.json({ data: { id: "X1" } });
        if (url.endsWith("/runs")) return Response.json({ data: { id: `R${posts.length}` } });
        return Response.json({ data: { id: "EV" } });
      }
      if (url.includes("/v1/datasets?name="))
        return Response.json({ data: [{ id: "D1", name: "narnia-read-document" }] });
      return Response.json({ data: { examples: [{ id: "ex1", input: { id: "cv-texto" } }] } });
    };
    const r = await recordLocalExperiment(
      {
        dataset: "narnia-read-document",
        name: "leitura · teste",
        runs: [
          {
            exampleId: "cv-texto",
            output: { text: "Ana" },
            startedAt: "2026-10-13T10:00:00Z",
            endedAt: "2026-10-13T10:00:05Z",
            evaluations: [
              { name: "json_schema", kind: "CODE", label: "passou", score: 1, explanation: "ok" },
              {
                name: "padrao_de_entrega",
                kind: "LLM",
                label: "parcial",
                score: 0.5,
                explanation: "faltou",
              },
            ],
          },
          { exampleId: "nao-existe", output: {}, startedAt: "x", endedAt: "x", evaluations: [] },
        ],
      },
      { baseUrl: "http://px", fetch: fetchFn },
    );
    expect(r).toEqual({ experimentId: "X1", runs: 1 });
    const run = posts.find((p) => p.url.endsWith("/experiments/X1/runs"));
    expect(run?.body).toMatchObject({
      dataset_example_id: "ex1",
      output: { text: "Ana" },
      repetition_number: 1,
    });
    const evals = posts.filter((p) => p.url.endsWith("/experiment_evaluations"));
    expect(evals.map((e) => [e.body.name, e.body.annotator_kind])).toEqual([
      ["json_schema", "CODE"],
      ["padrao_de_entrega", "LLM"],
    ]);
  });
});
