import { describe, expect, it } from "vitest";
import {
  locateKinds,
  locateRefs,
  roleplayChecks,
} from "../../src/evals/prompt-evaluators/application-locate";

/** F12/M3 · avaliadores do localizador: refs conferidas e tipos sensíveis (consentimento, autodeclaração). */
const input = {
  fields_json: JSON.stringify([{ ref: "f1" }, { ref: "f2" }, { ref: "f3" }, { ref: "f4" }]),
};
const out = (o: unknown) => ({ messages: [{ role: "assistant", content: JSON.stringify(o) }] });

describe("F12/M3 · avaliadores do localizador", () => {
  it("refs: todas com destino passa; inventada ou repetida zera; esquecida dá a fração", () => {
    const ok = out({
      questions: [
        { fieldRefs: ["f1", "f2"], kind: "number" },
        { fieldRefs: ["f3"], kind: "consent" },
      ],
      ignored: ["f4"],
    });
    expect(locateRefs({ input, output: ok })).toMatchObject({ label: "passou", score: 1 });
    const invented = out({ questions: [{ fieldRefs: ["f9"] }], ignored: ["f1", "f2", "f3", "f4"] });
    expect(locateRefs({ input, output: invented })).toMatchObject({ label: "falhou", score: 0 });
    const twice = out({
      questions: [{ fieldRefs: ["f1"] }, { fieldRefs: ["f1", "f2"] }],
      ignored: ["f3", "f4"],
    });
    expect(locateRefs({ input, output: twice }).score).toBe(0);
    const forgot = out({ questions: [{ fieldRefs: ["f1"] }], ignored: ["f2", "f3"] });
    expect(locateRefs({ input, output: forgot })).toMatchObject({ label: "falhou", score: 0.75 });
  });

  it("tipos: consentimento e autodeclaração esperados; rótulo quebrado junto", () => {
    const reference = { kinds: { f3: "consent", f4: "ignored" }, together: [["f1", "f2"]] };
    const ok = out({
      questions: [
        { fieldRefs: ["f1", "f2"], kind: "number" },
        { fieldRefs: ["f3"], kind: "consent" },
      ],
      ignored: ["f4"],
    });
    expect(locateKinds({ input, output: ok, reference })).toMatchObject({ label: "passou" });
    const bad = out({
      questions: [
        { fieldRefs: ["f1"], kind: "short_text" },
        { fieldRefs: ["f2"], kind: "number" },
        { fieldRefs: ["f3"], kind: "yes_no" },
      ],
      ignored: ["f4"],
    });
    const r = locateKinds({ input, output: bad, reference });
    expect(r.label).toBe("falhou");
    expect(r.score).toBeCloseTo(1 / 3);
  });
});

describe("F12-18 · avaliador do roleplay", () => {
  const rInput = {
    brief_json: JSON.stringify({ experiences: [{ id: "e1" }], skills: [{ id: "s1" }] }),
    questions_json: JSON.stringify([
      { questionId: "q1", maxChars: 200 },
      { questionId: "q2", maxChars: null },
    ]),
  };
  const reference = {
    gaps: ["q2"],
    assumes: ["q1"],
    mention: { q1: ["Vitalis"] },
    avoid: ["Lisboa"],
  };
  it("ancorado, no limite, com a suposição dita e o nome da empresa passa", () => {
    const ok = out({
      answers: [
        {
          questionId: "q1",
          answer: "Na Acme cuidei de pagamentos; a Vitalis mexe com isso em saúde.",
          assumptions: ["Que você quer trabalhar com saúde."],
          origins: ["e1"],
          gap: null,
        },
        { questionId: "q2", answer: null, assumptions: [], origins: [], gap: "Sem dados." },
      ],
    });
    expect(roleplayChecks({ input: rInput, output: ok, reference })).toMatchObject({
      label: "passou",
      score: 1,
    });
  });
  it("clichê, sem origem, sem suposição e fato da vaga seguido derrubam a nota", () => {
    const bad = out({
      answers: [
        {
          questionId: "q1",
          answer: "Sou apaixonado por tecnologia e moro em Lisboa.",
          assumptions: [],
          origins: [],
          gap: null,
        },
        { questionId: "q2", answer: "Inventei.", assumptions: [], origins: ["e1"], gap: null },
      ],
    });
    const r = roleplayChecks({ input: rInput, output: bad, reference });
    expect(r.label).toBe("falhou");
    expect(r.explanation).toMatch(/clichê/);
    expect(r.explanation).toMatch(/sem origem/);
    expect(r.explanation).toMatch(/suposição/);
    expect(r.explanation).toMatch(/Lisboa/);
    expect(r.explanation).toMatch(/q2: devia ser lacuna/);
  });
});
