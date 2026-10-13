import { describe, expect, it } from "vitest";
import { extractFactsOutputWithEvidence, hasIdentityData } from "../src/index";

/**
 * Texto livre sem dado de identidade: o modelo devolve `identity` só com confidence. Isso não pode virar proposta vazia
 * (aparecia na revisão como item em branco e "Sem suporte", relato do dono em 2026-10-13).
 */
const empty = { experiences: [], education: [], skills: [], languages: [], links: [] };

describe("identidade vazia na extração", () => {
  it("hasIdentityData só é verdadeiro com algum campo preenchido", () => {
    expect(hasIdentityData({})).toBe(false);
    expect(hasIdentityData({ fullName: " ", links: [] })).toBe(false);
    expect(hasIdentityData({ city: "Recife" })).toBe(true);
    expect(hasIdentityData({ links: [{ label: "GitHub", url: "https://github.com/x" }] })).toBe(
      true,
    );
  });

  it("identity sem dados não vira proposta; com dados continua", () => {
    expect(
      extractFactsOutputWithEvidence({ ...empty, identity: { confidence: 0.4 } }).proposals,
    ).toEqual([]);
    const r = extractFactsOutputWithEvidence({
      ...empty,
      identity: { confidence: 0.9, city: "Recife", evidence: { ref: "text", quote: "Recife" } },
    });
    expect(r.proposals).toEqual([{ kind: "identity", confidence: 0.9, data: { city: "Recife" } }]);
    expect(r.evidence).toEqual([{ ref: "text", quote: "Recife" }]);
  });
});
