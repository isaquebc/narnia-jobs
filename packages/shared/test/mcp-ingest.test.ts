import { describe, expect, it } from "vitest";
import { INGEST_TOOL_JSON_SCHEMAS, INGEST_TOOLS } from "../src/index";

describe("F03/M1 shared · tools MCP file.* e ingest.* (definição; exposição em F04)", () => {
  it("define as tools de arquivo e de ingestão com entrada e saída", () => {
    expect(Object.keys(INGEST_TOOLS).sort()).toEqual([
      "file.get_digest",
      "file.get_text",
      "file.list",
      "ingest.propose",
      "ingest.status",
    ]);
  });
  it("file.get_text recusa intervalo maior que 8k chars; get_digest aceita arquivo ou repositório", () => {
    const t = INGEST_TOOLS["file.get_text"].input;
    expect(t.safeParse({ fileId: "f1", from: 0, to: 8000 }).success).toBe(true);
    expect(t.safeParse({ fileId: "f1", from: 0, to: 8001 }).success).toBe(false);
    expect(t.safeParse({ fileId: "f1", from: 10, to: 5 }).success).toBe(false);
    const d = INGEST_TOOLS["file.get_digest"].input;
    expect(d.safeParse({ fileId: "f1" }).success).toBe(true);
    expect(d.safeParse({ repoId: "r1" }).success).toBe(true);
    expect(d.safeParse({}).success).toBe(false);
  });
  it("ingest.propose valida cada proposta pelo kind e exige evidência", () => {
    const p = INGEST_TOOLS["ingest.propose"].input;
    const ok = {
      runId: "run1",
      proposals: [
        {
          proposal: {
            kind: "skill",
            confidence: 0.9,
            data: { name: "React", category: "framework" },
          },
          evidence: { ref: "cv", quote: "React" },
        },
      ],
    };
    expect(p.safeParse(ok).success).toBe(true);
    const badKind = {
      ...ok,
      proposals: [
        {
          proposal: { kind: "skill", confidence: 0.9, data: { title: "x" } },
          evidence: ok.proposals[0]?.evidence,
        },
      ],
    };
    expect(p.safeParse(badKind).success).toBe(false);
    expect(
      p.safeParse({ ...ok, proposals: [{ proposal: ok.proposals[0]?.proposal }] }).success,
    ).toBe(false);
  });
  it("JSON Schema sem $schema e estável (snapshot)", () => {
    for (const s of Object.values(INGEST_TOOL_JSON_SCHEMAS)) {
      expect(s.input).not.toHaveProperty("$schema");
      expect(s.output).not.toHaveProperty("$schema");
    }
    expect(INGEST_TOOL_JSON_SCHEMAS).toMatchSnapshot();
  });
});
