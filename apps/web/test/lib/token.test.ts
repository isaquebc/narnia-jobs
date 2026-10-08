import { describe, expect, it } from "vitest";
import { enterUrl, readTokenFromSearch, stripTokenFromUrl } from "../../src/lib/token";

describe("lib/token · token de boot na URL", () => {
  it("lê o token da query string", () => {
    expect(readTokenFromSearch("?token=abc123&x=1")).toBe("abc123");
    expect(readTokenFromSearch("?x=1")).toBeNull();
    expect(readTokenFromSearch("")).toBeNull();
  });
  it("monta a URL de entrada que grava o cookie", () => {
    expect(enterUrl("abc")).toBe("/api/auth/enter?token=abc");
  });
  it("remove o token da URL preservando o resto", () => {
    expect(stripTokenFromUrl("http://localhost:3100/?token=abc&x=1")).toBe(
      "http://localhost:3100/?x=1",
    );
    expect(stripTokenFromUrl("http://localhost:3100/onboarding/2?token=abc")).toBe(
      "http://localhost:3100/onboarding/2",
    );
  });
});
