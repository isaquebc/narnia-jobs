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
});
