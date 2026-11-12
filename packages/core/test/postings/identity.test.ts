import { describe, expect, it } from "vitest";
import { postingIdentityHash, sameCompany, sameTitle } from "../../src/postings/identity";

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

describe("correção 2026-11-11 · mesma empresa e mesmo cargo (e-mail × vaga salva)", () => {
  it.each([
    ["Initech Ltda.", "initech", true],
    ["Nubank", "Nubank Tecnologia", true],
    ["Boticário", "Grupo Boticário", true],
    ["Itaú", "Itaú BBA", false],
    ["Stone", "Stone Age", false],
    ["Empresa Confidencial", "Empresa Confidencial", false],
    ["Confidencial", "Acme Confidencial", false],
  ])("empresa %s × %s → %s", (a, b, same) => {
    expect(sameCompany(a, b)).toBe(same);
  });

  it.each([
    ["Senior Software Engineer (Full Stack)", "Senior Software Engineer (Full Stack)", true],
    [
      "3672: Engenheiro(a) de Software Sênior Frontend Mobile",
      "Engenheiro(a) de Software Sênior Frontend Mobile",
      true,
    ],
    ["Desenvolvedor Backend Sênior | Remoto", "Desenvolvedor Back-end Sênior", true],
    ["DevOps Engineer ID95927", "DevOps Engineer", true],
    ["Senior Software Engineer", "Software Engineer", false],
    ["Desenvolvedor C# Sênior", "Desenvolvedor C++ Sênior", false],
    ["Desenvolvedor .NET", "Desenvolvedor Java", false],
    ["Analista de Sistemas 1", "Analista de Sistemas 2", false],
    ["Engenheiro de Software II", "Engenheiro de Software III", false],
    [
      "Desenvolvedor Backend Sênior Node Pagamentos Squad Cartões Remoto",
      "Desenvolvedor Frontend Sênior Node Pagamentos Squad Cartões Remoto",
      false,
    ],
  ])("cargo %s × %s → %s", (a, b, same) => {
    expect(sameTitle(a, b)).toBe(same);
  });
});
