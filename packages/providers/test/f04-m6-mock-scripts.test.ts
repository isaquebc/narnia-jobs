import { describe, expect, it } from "vitest";
import { mockChatScript } from "../src/mock/mock-provider";

/** F04/M6: roteiros do mock para os cenários e2e (as tools chamadas são as reais do `/mcp`). */
describe("F04/M6 · roteiros do chat do mock", () => {
  const career = { category: "career" as const, ingestionRunId: null };

  it("domínio fora da lista: research_save com URL não confiável (o servidor recusa)", () => {
    const [tool, args] = mockChatScript("pesquise salário num blog fora da lista", career);
    expect(tool).toBe("research_save");
    expect(String(args.url)).toMatch(/^https:\/\/blog\.exemplo-nao-confiavel\.com\//);
  });

  it("arquivo anexado: ingest_file com o id informado", () => {
    expect(mockChatScript("arquivo: 01abc-def", career)).toEqual([
      "ingest_file",
      { fileId: "01abc-def" },
    ]);
  });

  it("link do GitHub: ingest_github público, profundidade rápida, com o repositório informado", () => {
    expect(mockChatScript("github: ana-exemplo/api-pagamentos", career)).toEqual([
      "ingest_github",
      { mode: "public", repos: ["ana-exemplo/api-pagamentos"], depth: "quick" },
    ]);
  });

  it("roteiros anteriores continuam: salário → research_save confiável; texto → ingest_text; resto → experiências", () => {
    const [t1, a1] = mockChatScript("qual o salário de mercado?", career);
    expect(t1).toBe("research_save");
    expect(String(a1.url)).toContain("ibge.gov.br");
    expect(mockChatScript("texto: minha história", career)[0]).toBe("ingest_text");
    expect(mockChatScript("o que está fraco?", career)[0]).toBe("evidence_experience_list");
  });

  it("auditoria E1 · anexo do composer → ingest_file; confirmação → ingest_confirm; 'pode usar' → research_apply", () => {
    expect(
      mockChatScript(
        "[anexo: cv final.pdf · fileId 0199d3c2-7a10-7c3e-9f00-1234abcd5678]\nlê isso pra mim",
        career,
      ),
    ).toEqual(["ingest_file", { fileId: "0199d3c2-7a10-7c3e-9f00-1234abcd5678" }]);
    expect(
      mockChatScript("confirmo a ingestão 0199d3c2-7a10-7c3e-9f00-1234abcd5678", career)[0],
    ).toBe("ingest_confirm");
    const [tool, args] = mockChatScript("pode usar esse valor de 12 a 16 mil por mês", career);
    expect(tool).toBe("research_apply");
    expect(args).toMatchObject({
      field: "salary",
      salary: { min: 12000, max: 16000, currency: "BRL", period: "monthly" },
    });
  });
});
