import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { charsToTokens, estimateCall, PROMPT_OVERHEAD } from "../../src/estimate";
import { resolveModel } from "../../src/models";

describe("F02/M2 estimateCall e resolveModel (§2.9-7/8)", () => {
  it("estimateCall soma tokens da entrada e o overhead do prompt", () => {
    const c = estimateCall({
      inputChars: 4_000,
      overhead: PROMPT_OVERHEAD.analyzeProfiles,
      model: "sonnet",
    });
    expect(c).toEqual({
      model: "sonnet",
      tokens: charsToTokens(4_000) + PROMPT_OVERHEAD.analyzeProfiles,
    });
    expect(PROMPT_OVERHEAD.analyzeProfiles).toBeGreaterThan(0);
    expect(estimateCall({ inputChars: -5, overhead: 10, model: "haiku" }).tokens).toBe(10);
  });

  it("resolveModel lê settings.models.<chave> e cai no padrão quando ausente ou vazio", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    expect(resolveModel(r.settings, "analyze", "sonnet")).toBe("sonnet");
    r.settings.set("models", { extraction: { facts: "haiku" }, analyze: "opus" });
    expect(resolveModel(r.settings, "analyze", "sonnet")).toBe("opus");
    r.settings.set("models", { analyze: "" });
    expect(resolveModel(r.settings, "analyze", "sonnet")).toBe("sonnet");
  });
});
