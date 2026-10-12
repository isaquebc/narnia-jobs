import { TrustedDomainCreateRequestSchema } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { type ChatIngestPort, createChatTools } from "../../src/chat/tools";
import { createRepos, domainMatches, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** Auditoria pós-F04 · bloco A (2026-10-12): domínios confiáveis sem brecha para terceiros. */
describe("auditoria A · máscara `x.*` e normalização", () => {
  it("`glassdoor.*` casa sufixos públicos, não domínios de terceiros", () => {
    for (const h of ["glassdoor.com", "glassdoor.com.br", "glassdoor.co.uk", "www.glassdoor.de"])
      expect(domainMatches("glassdoor.*", h), h).toBe(true);
    for (const h of [
      "glassdoor.atacante.com",
      "glassdoor.salarios-falsos.com",
      "glassdoor.com.atacante.io",
      "glassdoor",
    ])
      expect(domainMatches("glassdoor.*", h), h).toBe(false);
    expect(domainMatches("indeed.*", "indeed.qualquer.xyz")).toBe(false);
    expect(domainMatches("indeed.*", "indeed.com")).toBe(true);
  });

  it("padrão com `www.` e maiúsculas é normalizado na validação da rota", () => {
    expect(
      TrustedDomainCreateRequestSchema.parse({ pattern: " WWW.Exemplo.COM ", trustTag: "other" })
        .pattern,
    ).toBe("exemplo.com");
    expect(
      TrustedDomainCreateRequestSchema.parse({ pattern: "IBGE.gov.br", trustTag: "official" })
        .pattern,
    ).toBe("ibge.gov.br");
    expect(domainMatches("exemplo.com", "www.exemplo.com")).toBe(true);
  });
});

const noIngest = {} as ChatIngestPort;

describe("auditoria A · research.save só http(s)", () => {
  it("esquemas fora de http/https são recusados mesmo em domínio confiável", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    seedFixture(repos, "engineer");
    const tools = createChatTools(repos, { ingest: noIngest, sessionId: null });
    for (const url of [
      "javascript://ibge.gov.br/%0aalert(1)",
      "file://ibge.gov.br/etc/passwd",
      "ftp://ibge.gov.br/x",
      "data:text/html,oi",
    ])
      await expect(
        (async () =>
          tools["research.save"]({ url, title: "t", excerpt: "e", usedFor: "salário" }))(),
        url,
      ).rejects.toThrow(/http/i);
    expect(
      await tools["research.save"]({
        url: "https://www.ibge.gov.br/x",
        title: "t",
        excerpt: "e",
        usedFor: "salário",
      }),
    ).toMatchObject({ domain: "ibge.gov.br", trustTag: "official" });
  });
});
