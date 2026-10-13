import { describe, expect, it } from "vitest";
import { checkVerdicts } from "../../src/evals/prompt-evaluators/check-verdicts";
import { jsonSchema } from "../../src/evals/prompt-evaluators/json-schema";
import { language } from "../../src/evals/prompt-evaluators/language";
import { jsonOf, textOf, validateSchema } from "../../src/evals/prompt-evaluators/lib";
import { literalQuotes } from "../../src/evals/prompt-evaluators/literal-quotes";
import { noInventedYears } from "../../src/evals/prompt-evaluators/no-invented-years";
import { pickFilesLimits } from "../../src/evals/prompt-evaluators/pick-files";
import { referenceCoverage } from "../../src/evals/prompt-evaluators/reference-coverage";
import { supportingIds } from "../../src/evals/prompt-evaluators/supporting-ids";

/**
 * Avaliações no Phoenix (M3): avaliadores de código dos prompts estruturados. `output` chega como no Phoenix
 * (`{ messages: [{ role: "assistant", content }] }`) ou como texto; `input` são as variáveis do template.
 */
const out = (value: unknown) => ({
  messages: [
    { role: "assistant", content: typeof value === "string" ? value : JSON.stringify(value) },
  ],
});

describe("lib", () => {
  it("textOf/jsonOf aceitam o formato do Phoenix, texto e objeto", () => {
    expect(textOf(out("oi"))).toBe("oi");
    expect(textOf("oi")).toBe("oi");
    expect(jsonOf(out({ a: 1 }))).toEqual({ a: 1 });
    expect(jsonOf({ a: 1 })).toEqual({ a: 1 });
    expect(jsonOf(out('```json\n{"a":2}\n```'))).toEqual({ a: 2 });
    expect(jsonOf(out("sem json"))).toBeUndefined();
  });

  it("validateSchema cobre tipo, obrigatórios, enum, itens, extras e tamanhos", () => {
    const schema = {
      type: "object",
      properties: {
        nome: { type: "string", minLength: 2 },
        nivel: { type: "string", enum: ["junior", "senior"] },
        itens: { type: "array", items: { type: "integer" }, maxItems: 2 },
        opc: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["nome", "nivel"],
      additionalProperties: false,
    };
    expect(validateSchema(schema, { nome: "Ana", nivel: "junior", itens: [1], opc: null })).toEqual(
      [],
    );
    expect(
      validateSchema(schema, { nome: "A", nivel: "chefe", itens: [1, 2.5, 3], extra: true }),
    ).toEqual([
      "$.nome: menos de 2 caracteres",
      "$.nivel: fora do enum (junior, senior)",
      "$.itens: mais de 2 itens",
      "$.itens[1]: esperado integer",
      "$.extra: campo não previsto",
    ]);
    expect(validateSchema(schema, {})).toEqual(["$.nome: obrigatório", "$.nivel: obrigatório"]);
  });
});

describe("avaliadores", () => {
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };

  it("json_schema: passa com JSON no schema; falha com texto ou campo errado", () => {
    expect(jsonSchema({ output: out({ ok: true }) }, { schema })).toMatchObject({ score: 1 });
    expect(jsonSchema({ output: out("não sei") }, { schema })).toMatchObject({
      score: 0,
      explanation: expect.stringContaining("não é JSON"),
    });
    expect(jsonSchema({ output: out({ ok: "sim" }) }, { schema })).toMatchObject({
      score: 0,
      explanation: expect.stringContaining("$.ok: esperado boolean"),
    });
  });

  it("citacoes_literais: todo evidence.quote aparece na fonte (espaços e caixa normalizados)", () => {
    const input = { text: "Liderou a migração de 12 serviços\npara Kubernetes, sem downtime." };
    const good = {
      experiences: [
        { evidence: { ref: "cv", quote: "liderou a migração de 12 serviços para kubernetes" } },
      ],
    };
    const bad = {
      skills: [{ evidence: { ref: "cv", quote: "Certificação AWS Solutions Architect" } }],
    };
    expect(literalQuotes({ output: out(good), input }, { sourceFields: ["text"] })).toMatchObject({
      score: 1,
    });
    const r = literalQuotes(
      { output: out({ ...good, ...bad }), input },
      { sourceFields: ["text"] },
    );
    expect(r).toMatchObject({ label: "falhou", score: 0.5 });
    expect(r.explanation).toContain("Certificação AWS");
    expect(literalQuotes({ output: out({}), input }, { sourceFields: ["text"] })).toMatchObject({
      score: 1,
      explanation: expect.stringContaining("nenhuma citação"),
    });
  });

  it("sem_anos_inventados: anos da saída precisam existir na fonte", () => {
    const input = { text: "Acme (2021–2023)" };
    expect(
      noInventedYears({ output: out({ start: "2021-03" }), input }, { sourceFields: ["text"] }),
    ).toMatchObject({ score: 1 });
    expect(
      noInventedYears({ output: out({ start: "2019" }), input }, { sourceFields: ["text"] }),
    ).toMatchObject({
      score: 0,
      explanation: expect.stringContaining("2019"),
    });
  });

  it("idioma: em pt-BR os textos livres saem em português", () => {
    const pt = {
      report: {
        summary:
          "O candidato tem experiência sólida com serviços de pagamento e uma boa base em Go.",
      },
    };
    const en = {
      report: {
        summary: "The candidate has solid experience with payment services and a good base in Go.",
      },
    };
    expect(
      language({ output: out(pt), input: { locale: "pt-BR" } }, { fields: ["summary"] }),
    ).toMatchObject({ score: 1 });
    expect(
      language({ output: out(en), input: { locale: "pt-BR" } }, { fields: ["summary"] }),
    ).toMatchObject({ score: 0 });
    expect(
      language({ output: out(en), input: { locale: "en-US" } }, { fields: ["summary"] }),
    ).toMatchObject({
      score: 1,
      explanation: expect.stringContaining("não se aplica"),
    });
  });

  it("limite_de_arquivos: no máximo max_files e só caminhos da árvore", () => {
    const input = {
      max_files: "2",
      tree: "README.md\nsrc/a.ts\nsrc/b.ts",
      candidates: "README.md",
    };
    expect(
      pickFilesLimits({ output: out({ files: [{ path: "README.md", reason: "r" }] }), input }),
    ).toMatchObject({ score: 1 });
    const r = pickFilesLimits({
      output: out({
        files: [
          { path: "README.md", reason: "r" },
          { path: "x.ts", reason: "r" },
          { path: "src/a.ts", reason: "r" },
        ],
      }),
      input,
    });
    expect(r.score).toBe(0);
    expect(r.explanation).toContain("3 arquivos (máximo 2)");
    expect(r.explanation).toContain("x.ts");
  });

  it("veredito_por_item: um resultado por proposta; com referência, mede o acerto", () => {
    const input = { items_json: JSON.stringify([{ proposalId: "p1" }, { proposalId: "p2" }]) };
    const ok = {
      results: [
        { proposalId: "p1", status: "supported" },
        { proposalId: "p2", status: "unsupported" },
      ],
    };
    expect(
      checkVerdicts({ output: out(ok), input, reference: { p1: "supported", p2: "unsupported" } }),
    ).toMatchObject({ score: 1 });
    expect(
      checkVerdicts({ output: out(ok), input, reference: { p1: "supported", p2: "supported" } }),
    ).toMatchObject({
      score: 0.5,
      explanation: expect.stringContaining("p2"),
    });
    expect(checkVerdicts({ output: out({ results: [ok.results[0]] }), input })).toMatchObject({
      score: 0,
      explanation: expect.stringContaining("sem veredito: p2"),
    });
  });

  it("ids_de_apoio: supportingFactIds só com ids do histórico", () => {
    const input = {
      history_json: JSON.stringify({ experiences: [{ id: "e1", achievements: [{ id: "a1" }] }] }),
    };
    expect(
      supportingIds({ output: out({ suggestions: [{ supportingFactIds: ["e1", "a1"] }] }), input }),
    ).toMatchObject({ score: 1 });
    expect(
      supportingIds({ output: out({ suggestions: [{ supportingFactIds: ["e9"] }] }), input }),
    ).toMatchObject({
      score: 0,
      explanation: expect.stringContaining("e9"),
    });
  });

  it("cobertura_da_referencia: termos esperados que aparecem na saída (recall) contra o mínimo", () => {
    const reference = { expected: ["Acme", "Globex", "Kubernetes", "Unicamp"] };
    const o = out({
      experiences: [{ company: "Acme Ltda" }, { company: "Globex S.A." }],
      skills: [{ name: "Kubernetes" }],
    });
    expect(referenceCoverage({ output: o, reference }, { min: 0.7 })).toMatchObject({
      score: 0.75,
      label: "passou",
    });
    expect(referenceCoverage({ output: o, reference }, { min: 0.8 })).toMatchObject({
      label: "falhou",
      explanation: expect.stringContaining("Unicamp"),
    });
    expect(referenceCoverage({ output: o, reference: {} }, { min: 0.8 })).toMatchObject({
      score: 1,
      explanation: expect.stringContaining("sem referência"),
    });
  });

  it("cobertura_da_referencia: termo proibido na saída (instrução escondida no documento) reprova", () => {
    const reference = { expected: ["Acme"], forbidden: ["Google"] };
    const r = referenceCoverage(
      { output: out({ company: "Acme e Google" }), reference },
      { min: 0.5 },
    );
    expect(r).toMatchObject({ label: "falhou", score: 0 });
    expect(r.explanation).toContain("proibido: Google");
    expect(
      referenceCoverage(
        { output: out({ company: "Acme" }), reference: { forbidden: ["Google"] } },
        { min: 0.5 },
      ),
    ).toMatchObject({ label: "passou", score: 1 });
  });
});
