import { describe, expect, it } from "vitest";
import { EXTRACTION_JSON_SCHEMAS, toJsonSchema } from "../src/index";
import { ReadDocumentOutputSchema } from "../src/schemas/extraction-output";

describe("M2/shared · JSON Schema para outputFormat do SDK", () => {
  it("gera objeto sem $schema (o validador do CLI rejeita o meta-schema 2020-12), com required e sem $ref externos", () => {
    // Regressão (2026-10-08, provider real): `--json-schema is not a valid JSON Schema: no schema with key or ref
    // "https://json-schema.org/draft/2020-12/schema"`. O CLI valida com ajv em draft-07 e sem meta-schemas remotos.
    const schema = toJsonSchema(ReadDocumentOutputSchema) as Record<string, unknown>;
    expect(schema).not.toHaveProperty("$schema");
    expect(JSON.stringify(schema)).not.toMatch(/draft\/2020-12|\$defs/);
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["text", "sections"]));
    expect(JSON.stringify(schema)).not.toMatch(/"\$ref":"(?!#)/);
  });
  it("nenhum dos três schemas da extração carrega $schema", () => {
    for (const s of Object.values(EXTRACTION_JSON_SCHEMAS)) expect(s).not.toHaveProperty("$schema");
  });

  it("expõe os três schemas da extração", () => {
    expect(Object.keys(EXTRACTION_JSON_SCHEMAS).sort()).toEqual([
      "buildDigest",
      "extractFacts",
      "readDocument",
    ]);
    for (const s of Object.values(EXTRACTION_JSON_SCHEMAS)) {
      expect((s as { type: string }).type).toBe("object");
    }
  });

  it("é estável (snapshot): mudar um schema exige atualizar o snapshot de propósito", () => {
    expect(EXTRACTION_JSON_SCHEMAS).toMatchSnapshot();
  });
});
