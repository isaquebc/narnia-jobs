import { describe, expect, it } from "vitest";
import { postingIdentityHash } from "../../src/postings/identity";

/** F06-2/F06-9 · identidade da vaga: empresa + cliente + cargo + role, sem data de publicação. */
describe("F06/M2 core · postingIdentityHash", () => {
  const base = {
    company: "Accenture",
    client: "Itaú",
    title: "Engenheiro Backend Sênior",
    role: "backend" as const,
  };

  it("caixa, acentos, pontuação e espaços não mudam o hash", () => {
    expect(
      postingIdentityHash({
        company: "  ACCENTURE ",
        client: "itau",
        title: "Engenheiro  backend - SÊNIOR",
        role: "backend",
      }),
    ).toBe(postingIdentityHash(base));
  });

  it("empresa, cliente, cargo ou role diferentes mudam o hash", () => {
    const h = postingIdentityHash(base);
    expect(postingIdentityHash({ ...base, company: "Nubank" })).not.toBe(h);
    expect(postingIdentityHash({ ...base, client: null })).not.toBe(h);
    expect(postingIdentityHash({ ...base, title: "Engenheiro Frontend" })).not.toBe(h);
    expect(postingIdentityHash({ ...base, role: "frontend" })).not.toBe(h);
  });

  it("sem empresa, ou sem cargo e sem role, não há identidade", () => {
    expect(postingIdentityHash({ title: "Dev" })).toBeNull();
    expect(postingIdentityHash({ company: "Nubank" })).toBeNull();
    expect(postingIdentityHash({ company: "Nubank", role: "backend" })).toMatch(/^[0-9a-f]{32}$/);
  });
});
