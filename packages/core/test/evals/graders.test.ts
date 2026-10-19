import { describe, expect, it } from "vitest";
import { type EvalCase, gradeTranscript, parseEvalCases } from "../../src/evals/graders";

/** F04/M5 · avaliadores determinísticos das conversas de referência (sem tokens). */
const transcript = {
  replies: [
    "Olhei suas experiências (fonte: evidence_experience_list). O ponto fraco: conquistas sem métrica em 2021; qual resultado você consegue medir?",
  ],
  tools: ["evidence_experience_list"],
  card: "Ana Maria Exemplo · Acme 2019–2023 · Beta 2021–hoje",
};

describe("F04/M5 · avaliadores do chat", () => {
  it("uses_tool, cites_source, asks_question e no_unknown_years passam numa resposta boa", () => {
    const r = gradeTranscript(transcript, [
      { type: "uses_tool", value: "evidence_experience_list" },
      { type: "cites_source" },
      { type: "asks_question" },
      { type: "no_unknown_years" },
    ]);
    expect(r.every((g) => g.passed)).toBe(true);
  });

  it("uses_tool aceita alternativas separadas por | (qualquer uma passa)", () => {
    const ok = gradeTranscript({ ...transcript, tools: ["cv_get", "cv_edit"] }, [
      { type: "uses_tool", value: "cv_edit|cv_generate" },
    ]);
    expect(ok[0]?.passed).toBe(true);
    const no = gradeTranscript({ ...transcript, tools: ["cv_get"] }, [
      { type: "uses_tool", value: "cv_edit|cv_generate" },
    ]);
    expect(no[0]?.passed).toBe(false);
  });

  it("acusa tool ausente, ano inventado, falta de fonte e de pedido de confirmação", () => {
    const bad = {
      replies: ["Você trabalhou na Acme em 2015 e foi ótimo."],
      tools: [],
      card: transcript.card,
    };
    const r = gradeTranscript(bad, [
      { type: "uses_tool", value: "evidence_experience_list" },
      { type: "cites_source" },
      { type: "asks_confirmation" },
      { type: "no_unknown_years" },
    ]);
    expect(r.map((g) => [g.type, g.passed])).toEqual([
      ["uses_tool", false],
      ["cites_source", false],
      ["asks_confirmation", false],
      ["no_unknown_years", false],
    ]);
    expect(r[3]?.detail).toContain("2015");
  });

  it("mentions_review exige que a ingestão vá para a revisão, sem afirmar que gravou direto", () => {
    const ok = {
      replies: [
        "Criei uma ingestão; as propostas estão na revisão, nada foi gravado sem você aprovar.",
      ],
      tools: ["ingest_text"],
      card: "",
    };
    const bad = {
      replies: ["Pronto, gravei tudo no seu perfil."],
      tools: ["ingest_text"],
      card: "",
    };
    expect(gradeTranscript(ok, [{ type: "mentions_review" }])[0]?.passed).toBe(true);
    expect(gradeTranscript(bad, [{ type: "mentions_review" }])[0]?.passed).toBe(false);
  });

  it("parseEvalCases lê o JSONL e recusa caso sem mensagens ou com avaliador desconhecido", () => {
    const cases: EvalCase[] = parseEvalCases(
      '{"id":"fraco","messages":["o que está fraco?"],"graders":[{"type":"cites_source"}]}\n\n',
    );
    expect(cases).toHaveLength(1);
    expect(() => parseEvalCases('{"id":"x","messages":[],"graders":[]}')).toThrow();
    expect(() =>
      parseEvalCases('{"id":"x","messages":["a"],"graders":[{"type":"magia"}]}'),
    ).toThrow();
  });

  describe("avaliadores da auditoria E2 (19b): empresas, domínios e orçamento", () => {
    const base = {
      tools: [],
      card: "Ana Maria Exemplo · Backend na Acme Pagamentos 2019–2023 · Beta Bank 2021–hoje",
    };

    it("no_unknown_companies: empresa citada precisa estar no cartão ou no que o usuário disse", () => {
      const ok = {
        ...base,
        replies: [
          "Na Acme Pagamentos você liderou o checkout; no Beta Bank faltam métricas. E na Zeta, que você citou?",
        ],
        userText: ["também trabalhei na Zeta Labs como freelancer"],
      };
      const bad = { ...base, replies: ["Sua passagem pela Globex Corp foi a mais forte."] };
      expect(gradeTranscript(ok, [{ type: "no_unknown_companies" }])[0]?.passed).toBe(true);
      const r = gradeTranscript(bad, [{ type: "no_unknown_companies" }])[0];
      expect(r?.passed).toBe(false);
      expect(r?.detail).toContain("Globex Corp");
    });

    it("no_unknown_companies: fim de frase não emenda nomes; país e bases públicas não são empresa (F06/M1)", () => {
      const t = {
        ...base,
        card: "Acme Pagamentos · Engenheira",
        replies: [
          "Seu melhor resultado foi na Acme. Vale destacar a latência. Os dados do Brasil e do CAGED mostram a faixa; você fica acima do P75.",
        ],
      };
      expect(gradeTranscript(t, [{ type: "no_unknown_companies" }])[0]).toMatchObject({
        passed: true,
      });
    });

    it("no_unknown_companies: fonte citada (domínio confiável ou registrado) não conta como empresa inventada", () => {
      const t = {
        ...base,
        replies: ["Segundo a pesquisa do IBGE e os dados do Glassdoor, a faixa é de 12 a 16 mil."],
        sources: [{ url: "https://www.ibge.gov.br/explica/desemprego.php", userConfirmed: false }],
        trustedDomains: ["*.gov.br", "glassdoor.*"],
      };
      expect(gradeTranscript(t, [{ type: "no_unknown_companies" }])[0]).toMatchObject({
        passed: true,
      });
    });

    it("trusted_sources_only: fontes salvas e links citados só de domínio confiável (ou confirmados pelo usuário)", () => {
      const trusted = ["*.gov.br", "glassdoor.*"];
      const ok = {
        ...base,
        replies: [
          "Segundo o IBGE (https://www.ibge.gov.br/salarios) e o https://glassdoor.com.br/x",
        ],
        sources: [
          { url: "https://www.ibge.gov.br/salarios", userConfirmed: false },
          { url: "https://blog.exemplo.dev/faixas", userConfirmed: true },
        ],
        trustedDomains: trusted,
      };
      const bad = {
        ...base,
        replies: ["Veja https://salarios-falsos.com/dev"],
        sources: [{ url: "https://glassdoor.atacante.com/x", userConfirmed: false }],
        trustedDomains: trusted,
      };
      expect(gradeTranscript(ok, [{ type: "trusted_sources_only" }])[0]?.passed).toBe(true);
      const r = gradeTranscript(bad, [{ type: "trusted_sources_only" }])[0];
      expect(r?.passed).toBe(false);
      expect(r?.detail).toMatch(/glassdoor\.atacante\.com/);
      expect(r?.detail).toMatch(/salarios-falsos\.com/);
    });

    it("within_budget: custo dentro do teto, tokens dentro do valor do caso e nenhum turno no limite de turnos", () => {
      const t = {
        ...base,
        replies: ["ok"],
        usage: { tokens: 9000, costUsd: 0.2 },
        budgetUsd: 0.5,
        maxTurns: 8,
        toolsPerReply: [3],
      };
      expect(gradeTranscript(t, [{ type: "within_budget", value: "10000" }])[0]?.passed).toBe(true);
      expect(gradeTranscript(t, [{ type: "within_budget", value: "5000" }])[0]?.passed).toBe(false);
      expect(
        gradeTranscript({ ...t, budgetUsd: 0.1 }, [{ type: "within_budget" }])[0]?.passed,
      ).toBe(false);
      const turns = gradeTranscript({ ...t, toolsPerReply: [8] }, [{ type: "within_budget" }])[0];
      expect(turns?.passed).toBe(false);
      expect(turns?.detail).toMatch(/limite de turnos/);
    });
  });
});
