import type { CalibrationItem } from "@narnia-jobs/core";
import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { calibrateJudges } from "../src/evals/calibration";
import { savedPostingsText } from "../src/evals/cli-evals";
import { judgeContext } from "../src/evals/run";
import { makeTestApp } from "./helpers";

/** Calibração dos juízes (pedido do dono, 2026-10-24): o runner usa o juiz e o pairwise do gate, com o contexto do sandbox. */
const result = (structured: Record<string, unknown>) =>
  ({
    text: "",
    structured,
    model: "m",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: "m" },
    costUsd: 0,
  }) as CompleteResult;

/** Juiz falso: reprova o que tem "INVENTADA"; no par, escolhe a que tem "MELHOR"; sem marca, fica sempre com A. */
const fakeJudge = () => {
  const seen: CompleteInput[] = [];
  return {
    seen,
    provider: {
      complete: async (i: CompleteInput) => {
        seen.push(i);
        // juiz do recrutador com perguntas (FF-4): G1 (inventa) para o que tem "INVENTADA"
        if ("itens" in ((i.jsonSchema?.properties as object) ?? {}))
          return result({
            itens: [{ id: "G1", defeito: i.prompt.includes("INVENTADA"), trecho: "INVENTADA" }],
          });
        const better = i.prompt.indexOf("MELHOR");
        const worse = i.prompt.indexOf("PIOR");
        const vencedor = better < 0 || worse < 0 ? "A" : better < worse ? "A" : "B";
        return result({ vencedor, explicacao: "ok" });
      },
    },
  };
};

const answer = (text: string) => ({ replies: [text], tools: ["fact_search"] });
const items: CalibrationItem[] = [
  {
    id: "limpa",
    kind: "absolute",
    case: "corrigir-cargo",
    defect: "limpa",
    expect: "atende",
    ...answer("Propus a troca do cargo."),
  },
  {
    id: "inventa",
    kind: "absolute",
    case: "corrigir-cargo",
    defect: "inventa",
    expect: "nao_atende",
    ...answer("Empresa INVENTADA."),
  },
  {
    id: "brando",
    kind: "absolute",
    case: "corrigir-cargo",
    defect: "mercado",
    expect: "parcial",
    ...answer("Vagas pedem Kafka."),
  },
  {
    id: "par-ok",
    kind: "pair",
    case: "cv-pelo-chat",
    defect: "link",
    better: answer("MELHOR"),
    worse: answer("PIOR"),
  },
  {
    id: "par-posicao",
    kind: "pair",
    case: "cv-pelo-chat",
    defect: "link",
    better: answer("uma"),
    worse: answer("outra"),
  },
];

describe("calibração dos juízes · runner", () => {
  it("juiz do recrutador com o contexto e a conversa do caso; par nas duas ordens; relatório com os erros", async () => {
    const j = fakeJudge();
    const r = await calibrateJudges(items, {
      provider: j.provider,
      context: "CARTÃO DA FIXTURE",
      messagesOf: (c) => [`mensagem do caso ${c}`],
    });
    expect(r.report.absolute).toMatchObject({ total: 3, right: 2, falsePositives: 1 });
    expect(r.report.pairs).toMatchObject({ total: 2, right: 1, positionBias: 1 });
    expect(r.report.mistakes.map((m) => m.id)).toEqual(["brando", "par-posicao"]);
    // o juiz absoluto recebe o contexto da fixture e a mensagem do caso
    const absolute = j.seen.find((s) => s.prompt.includes("Propus a troca do cargo."));
    expect(absolute?.prompt).toContain("CARTÃO DA FIXTURE");
    expect(absolute?.prompt).toContain("mensagem do caso corrigir-cargo");
    // explicação do juiz por caso, para ler o motivo do erro
    expect(r.explanations.brando).toBe("nenhum defeito");
    expect(r.explanations.inventa).toBe("G1: «INVENTADA»");
    expect(j.seen).toHaveLength(3 + 2 * 2);
  });

  it("troca os marcadores da fixture (id do perfil do sandbox) nas respostas antes de julgar", async () => {
    const j = fakeJudge();
    await calibrateJudges(
      [
        {
          id: "link",
          kind: "absolute",
          case: "cv-pelo-chat",
          defect: "limpa",
          expect: "atende",
          ...answer("Fica em /perfis/{{profileId}}/curriculo."),
        },
      ],
      {
        provider: j.provider,
        context: "",
        messagesOf: () => ["oi"],
        vars: { profileId: "p-123" },
      },
    );
    expect(j.seen[0]?.prompt).toContain("/perfis/p-123/curriculo");
    expect(j.seen[0]?.prompt).not.toContain("{{profileId}}");
  });

  it("caso de calibração apontando para um caso do chat que não existe falha cedo", async () => {
    await expect(
      calibrateJudges(items, {
        provider: fakeJudge().provider,
        context: "",
        messagesOf: () => null,
      }),
    ).rejects.toThrow(/corrigir-cargo/);
  });
});

describe("contexto do juiz do recrutador (calibração, 2026-10-24)", () => {
  it("cartões e, numa seção própria, todos os fatos registrados (o que as ferramentas podem devolver)", () => {
    const c = judgeContext(
      "# Cartões\nAcme Pagamentos",
      "Mentoria\nÉpsilon Startups · Desenvolvedora Júnior",
    );
    expect(c).toContain("# Cartões\nAcme Pagamentos");
    expect(c).toMatch(
      /<fatos_registrados>\nMentoria\nÉpsilon Startups · Desenvolvedora Júnior\n<\/fatos_registrados>/,
    );
    expect(judgeContext("só o cartão", "")).toBe("só o cartão");
    // vagas salvas (F12/M5): a empresa da vaga do formulário não é invenção, mas também não é fato da pessoa
    expect(judgeContext("cartão", "", "Globex Consultoria · Desenvolvedora Backend Sênior")).toBe(
      "cartão\n\n<vagas_salvas>\nGlobex Consultoria · Desenvolvedora Backend Sênior\n</vagas_salvas>",
    );
  });
});

describe("vagas salvas no contexto do juiz (2026-10-26)", () => {
  it("traz a descrição de cada vaga, que é o que o posting_get devolve: citar o que a vaga pede não é invenção", () => {
    // gate do M5: o juiz via só empresa e cargo e punia "a vaga pede Node.js, TypeScript, PostgreSQL e Kubernetes"
    const app = makeTestApp();
    try {
      app.repos.postings.create({
        company: "Globex Consultoria",
        role: "backend",
        title: "Desenvolvedora Backend Sênior",
        jdText: "Requisitos: Node.js e Kubernetes. Diferenciais: Kafka.",
      });
      app.repos.postings.create({
        company: "Initech",
        role: "data_engineering",
        title: "Analista",
        jdText: `Requisitos: SQL. ${"x".repeat(5000)}`,
      });
      const text = savedPostingsText(app.repos);
      expect(text).toContain(
        "Globex Consultoria · Desenvolvedora Backend Sênior\nDescrição: Requisitos: Node.js e Kubernetes. Diferenciais: Kafka.",
      );
      expect(text).toContain("Initech · Analista\nDescrição: Requisitos: SQL.");
      // descrição longa cortada: o contexto do juiz não cresce sem limite
      expect(text.length).toBeLessThan(3000);
      expect(text).toContain("…");
    } finally {
      app.cleanup();
    }
  });
});
