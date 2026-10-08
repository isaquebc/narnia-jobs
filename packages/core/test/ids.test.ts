import { describe, expect, it } from "vitest";
import { newId } from "../src/ids";

describe("ids (F01-19: UUID v7)", () => {
  it("gera UUID v7 únicos e ordenáveis por tempo", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });
});
