import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/index";

/** F06/M4 · mock da extração, do merge e da duplicata: previsível para os testes e o e2e. */
const JD = `Desenvolvedor(a) Backend Sênior
Empresa: Globex Consultoria · Cliente: Initech Bank
São Paulo - SP · Híbrido · CLT
Requisitos: Java, Kafka e PostgreSQL`;

describe("F06/M4 · MockProvider da vaga", () => {
  it("postingExtract: rótulos, título, role, senioridade, modo, contrato e termos conhecidos", async () => {
    const r = await new MockProvider().postingExtract({ text: JD, model: "haiku" });
    expect(r.output.fields).toMatchObject({
      company: "Globex Consultoria",
      client: "Initech Bank",
      title: "Desenvolvedor(a) Backend Sênior",
      role: "backend",
      seniority: "senior",
      workMode: "hybrid",
      contractType: "clt",
    });
    expect(r.output.keywords.map((k) => k.term)).toEqual(["PostgreSQL", "Java", "Kafka"]);
  });

  it("postingMerge: valor do modelo vence; iguais saem como both; só da heurística mantém a origem", async () => {
    const p = new MockProvider();
    const extracted = (await p.postingExtract({ text: JD, model: "haiku" })).output;
    const r = await p.postingMerge({
      text: JD,
      model: "haiku",
      extracted,
      heuristic: {
        fields: { company: "Globex Consultoria", city: "São Paulo" },
        keywords: [
          { term: "Java", section: "required" },
          { term: "Spring", section: "required" },
        ],
      },
    });
    const src = Object.fromEntries(r.output.fieldSources.map((f) => [f.field, f.source]));
    expect(src).toMatchObject({ company: "both", city: "heuristic", title: "model" });
    expect(r.output.keywords.find((k) => k.term === "Java")?.source).toBe("both");
    expect(r.output.keywords.find((k) => k.term === "Spring")?.source).toBe("heuristic");
  });

  it("postingDuplicate: JD igual dá 95% e mesma vaga; JD diferente dá 55% com as diferenças", async () => {
    const p = new MockProvider();
    const same = await p.postingDuplicate({
      model: "haiku",
      saved: { fields: { company: "A" }, jdText: JD },
      incoming: { fields: { company: "A" }, jdText: `${JD}  ` },
    });
    expect(same.output).toMatchObject({ sameJob: true, confidence: 95 });
    const other = await p.postingDuplicate({
      model: "haiku",
      saved: { fields: { company: "A", city: "São Paulo" }, jdText: JD },
      incoming: { fields: { company: "A", city: "Recife" }, jdText: "outro texto" },
    });
    expect(other.output.confidence).toBe(55);
    expect(other.output.differences.map((d) => d.field)).toEqual(["descrição", "city"]);
  });
});
