import { readFileSync } from "node:fs";
import { SenioritySchema } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";

describe("Auditoria F02 (2026-10-08) · prompt analyze-profiles", () => {
  it("10. as senioridades oferecidas no prompt são exatamente as de SenioritySchema", () => {
    const prompt = readFileSync(
      new URL("../src/claude-code/prompts/analyze-profiles.md", import.meta.url),
      "utf8",
    );
    const m = /`seniority` \(([^)]*)\)/.exec(prompt);
    expect(m).not.toBeNull();
    const offered = (m?.[1] ?? "")
      .split(/,|\bou\b/)
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(offered).toEqual([...SenioritySchema.options].sort());
  });
});
