import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE } from "../src/index";

describe("M1/shared smoke", () => {
  it("exporta o identificador do pacote", () => {
    expect(SHARED_PACKAGE).toBe("@narnia-jobs/shared");
  });
});
