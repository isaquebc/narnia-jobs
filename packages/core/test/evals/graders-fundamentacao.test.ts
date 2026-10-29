import { describe, expect, it } from "vitest";
import { gradeTranscript, parseEvalCases, type Transcript } from "../../src/evals/graders";

/**
 * Avaliadores por código do recrutador fundamentado (F04-fix-fundamentacao, R3, FF-4): o que o juiz julgava "de olho"
 * e dá para conferir sem modelo. Buscar antes de afirmar ausência (A1), número de mercado só com pesquisa (A2), não
 * prometer gravar sem a revisão (A5), tamanho da resposta (A6) e uma regex genérica para "diz o resultado" (A4).
 */
const t = (o: Partial<Transcript>): Transcript => ({
  replies: [],
  tools: [],
  card: "Acme Pagamentos · Engenheira · 2023–atual\nPretensão: R$ 18–25 mil",
  userText: [],
  ...o,
});
const grade = (tr: Transcript, type: string, value?: string) =>
  gradeTranscript(tr, [{ type, ...(value ? { value } : {}) } as never])[0];

describe("searched_before_absence (A1)", () => {
  it("afirmar que algo não está no perfil exige busca no mesmo turno", () => {
    const claim = "Mentoria não está no seu perfil, vale registrar.";
    expect(
      grade(
        t({ replies: [claim], toolsByReply: [["evidence_skill_list"]] }),
        "searched_before_absence",
      )?.passed,
    ).toBe(false);
    expect(
      grade(t({ replies: [claim], toolsByReply: [["fact_search"]] }), "searched_before_absence")
        ?.passed,
    ).toBe(true);
    // a busca em outro turno não vale
    expect(
      grade(
        t({ replies: ["Ok.", claim], toolsByReply: [["fact_search"], []] }),
        "searched_before_absence",
      )?.passed,
    ).toBe(false);
    expect(
      grade(
        t({ replies: ["Não encontrei Kafka nos seus fatos."], toolsByReply: [[]] }),
        "searched_before_absence",
      )?.passed,
    ).toBe(false);
    expect(
      grade(t({ replies: ["Você tem Kubernetes."], toolsByReply: [[]] }), "searched_before_absence")
        ?.passed,
    ).toBe(true);
  });
});

describe("market_numbers_sourced (A2)", () => {
  it("valor em dinheiro que não veio do usuário nem do perfil precisa de pesquisa registrada", () => {
    const reply = "Para o seu cargo o mercado paga R$ 14 a 20 mil.";
    expect(grade(t({ replies: [reply] }), "market_numbers_sourced")?.passed).toBe(false);
    expect(
      grade(
        t({
          replies: [reply],
          tools: ["research_save"],
          sources: [{ url: "https://glassdoor.com.br/x", userConfirmed: false }],
        }),
        "market_numbers_sourced",
      )?.passed,
    ).toBe(true);
    // a pretensão do perfil e o valor que o usuário disse não são número de mercado
    expect(
      grade(t({ replies: ["Sua pretensão é R$ 18–25 mil."] }), "market_numbers_sourced")?.passed,
    ).toBe(true);
    expect(
      grade(
        t({
          replies: ["Com R$ 14 mil de CLT, o PJ equivalente sai maior."],
          userText: ["ganho R$ 14 mil CLT"],
        }),
        "market_numbers_sourced",
      )?.passed,
    ).toBe(true);
  });
});

describe("no_save_promise (A5)", () => {
  it("prometer gravar direto reprova; dizer que vai para a revisão passa", () => {
    expect(
      grade(t({ replies: ["Eu registro as respostas como fatos."] }), "no_save_promise")?.passed,
    ).toBe(false);
    expect(
      grade(t({ replies: ["Vou adicionar isso ao seu perfil."] }), "no_save_promise")?.passed,
    ).toBe(false);
    expect(
      grade(
        t({ replies: ["Mandei para a revisão: confirme antes de entrar no perfil."] }),
        "no_save_promise",
      )?.passed,
    ).toBe(true);
  });
});

describe("max_reply_chars (A6) e mentions (A4)", () => {
  it("tamanho por resposta e regex no texto", () => {
    expect(grade(t({ replies: ["x".repeat(900)] }), "max_reply_chars", "800")?.passed).toBe(false);
    expect(grade(t({ replies: ["x".repeat(700)] }), "max_reply_chars", "800")?.passed).toBe(true);
    expect(
      grade(t({ replies: ["Aderência alta, lacuna em Kafka."] }), "mentions", "ader[êe]ncia|fit")
        ?.passed,
    ).toBe(true);
    expect(
      grade(t({ replies: ["Deixei um botão."] }), "mentions", "ader[êe]ncia|fit")?.passed,
    ).toBe(false);
  });

  it("os tipos novos valem nos casos", () => {
    expect(
      parseEvalCases(
        '{"id":"a","messages":["oi"],"graders":[{"type":"max_reply_chars","value":"800"},{"type":"searched_before_absence"}]}',
      ),
    ).toHaveLength(1);
  });
});
