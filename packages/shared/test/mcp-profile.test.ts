import { describe, expect, it } from "vitest";
import { PROFILE_TOOL_JSON_SCHEMAS, PROFILE_TOOLS } from "../src/index";

describe("F02/M1 shared · tools MCP profile.* (definição; exposição em F04)", () => {
  it("define as seis tools de §2.8 com schema de entrada e de saída", () => {
    expect(Object.keys(PROFILE_TOOLS).sort()).toEqual([
      "profile.create",
      "profile.get_card",
      "profile.list",
      "profile.switch",
      "profile.update_emphasis",
      "profile.update_pitch",
    ]);
    for (const tool of Object.values(PROFILE_TOOLS)) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.input).toBeDefined();
      expect(tool.output).toBeDefined();
    }
  });
  it("valida entradas: switch exige profileId; get_card aceita vazio; create exige o alvo", () => {
    expect(PROFILE_TOOLS["profile.switch"].input.safeParse({}).success).toBe(false);
    expect(PROFILE_TOOLS["profile.get_card"].input.safeParse({}).success).toBe(true);
    expect(PROFILE_TOOLS["profile.create"].input.safeParse({ name: "PM" }).success).toBe(false);
    expect(
      PROFILE_TOOLS["profile.create"].input.safeParse({
        name: "PM",
        targetTitle: "Project Manager",
        seniority: "senior",
        area: "produto",
        goal: "career_change",
        market: "BR",
        docLocale: "pt-BR",
      }).success,
    ).toBe(true);
    expect(
      PROFILE_TOOLS["profile.update_emphasis"].input.safeParse({
        profileId: "p1",
        items: [{ kind: "skill", id: "s1", mode: "highlight", position: 0 }],
      }).success,
    ).toBe(true);
  });
  it("JSON Schema de cada tool sem $schema (regra do CLI) e estável (snapshot)", () => {
    for (const s of Object.values(PROFILE_TOOL_JSON_SCHEMAS)) {
      expect(s.input).not.toHaveProperty("$schema");
      expect(s.output).not.toHaveProperty("$schema");
    }
    expect(PROFILE_TOOL_JSON_SCHEMAS).toMatchSnapshot();
  });
});
