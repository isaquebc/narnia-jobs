import {
  BuildDigestOutputSchema,
  ExtractFactsOutputSchema,
  ReadDocumentOutputSchema,
} from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { MockProvider, ProviderError } from "../src/index";

describe("M1/providers MockProvider.detect", () => {
  it("por padrão reporta CLI instalado e logado por volume (claude.ai)", async () => {
    const status = await new MockProvider().detect();
    expect(status).toMatchObject({
      installed: true,
      loggedIn: true,
      authMethod: "claude.ai",
    });
    expect(status.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("em modo loggedOut reporta não logado com dica de login", async () => {
    const status = await new MockProvider({ loggedIn: false }).detect();
    expect(status.loggedIn).toBe(false);
    expect(status.authMethod).toBe("none");
    expect(status.loginHint).toContain("narnia-jobs login");
  });

  it("aceita authMethod oauth_token para simular token do .env", async () => {
    const status = await new MockProvider({ authMethod: "oauth_token" }).detect();
    expect(status.loggedIn).toBe(true);
    expect(status.authMethod).toBe("oauth_token");
  });
});

describe("M4/providers MockProvider: modos controláveis e fixtures", () => {
  it("setMode altera o estado em memória (loggedOut → logado) e getMode devolve o modo atual", async () => {
    const p = new MockProvider({ loggedIn: false });
    expect((await p.detect()).loggedIn).toBe(false);
    p.setMode({ loggedIn: true, authMethod: "oauth_token" });
    expect(p.getMode()).toMatchObject({ loggedIn: true, authMethod: "oauth_token" });
    expect((await p.detect()).authMethod).toBe("oauth_token");
  });

  it("readDocument/extractFacts/buildDigest devolvem fixtures fictícias válidas contra os schemas, com usage e custo", async () => {
    const p = new MockProvider();
    const read = await p.readDocument({
      filePath: "/data/uploads/x.pdf",
      locale: "pt-BR",
      model: "haiku",
    });
    expect(ReadDocumentOutputSchema.parse(read.output)).toBeTruthy();
    expect(read.usage.model).toBe("haiku");
    expect(read.usage.inputTokens).toBeGreaterThan(0);

    const facts = await p.extractFacts({ text: read.output.text, locale: "pt-BR", model: "haiku" });
    const parsed = ExtractFactsOutputSchema.parse(facts.output);
    expect(parsed.experiences.length).toBeGreaterThanOrEqual(1);
    expect(parsed.skills.length).toBeGreaterThanOrEqual(3);
    expect(parsed.identity?.email).toMatch(/@example\.com$/);
    expect(facts.usage.outputTokens).toBeGreaterThan(0);
    expect(facts.costUsd).toBeGreaterThanOrEqual(0);

    const digest = await p.buildDigest({
      text: read.output.text,
      proposals: [],
      locale: "pt-BR",
      model: "sonnet",
    });
    expect(BuildDigestOutputSchema.parse(digest.output).summary.length).toBeGreaterThan(20);
    expect(digest.usage.model).toBe("sonnet");
    expect(digest.sdk.usage?.input_tokens).toBe(digest.usage.inputTokens);
  });

  it("modo slow atrasa a resposta pelo tempo configurado", async () => {
    const p = new MockProvider({ delayMs: 60 });
    const t0 = Date.now();
    await p.extractFacts({ text: "x".repeat(300), locale: "pt-BR", model: "haiku" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });

  it("modo error por operação lança ProviderError só na operação configurada", async () => {
    const p = new MockProvider({ errors: { buildDigest: "falha simulada no digest" } });
    await expect(
      p.extractFacts({ text: "x".repeat(300), locale: "pt-BR", model: "haiku" }),
    ).resolves.toBeTruthy();
    await expect(
      p.buildDigest({ text: "x", proposals: [], locale: "pt-BR", model: "sonnet" }),
    ).rejects.toBeInstanceOf(ProviderError);
    p.setMode({ errors: {} });
    await expect(
      p.buildDigest({ text: "x", proposals: [], locale: "pt-BR", model: "sonnet" }),
    ).resolves.toBeTruthy();
  });
});

describe("M4/providers createProviderFromEnv", () => {
  it("NARNIA_PROVIDER=mock → MockProvider; ausente → claude-code", async () => {
    const { createProviderFromEnv, providerIdFromEnv } = await import("../src/index");
    expect(providerIdFromEnv({ NARNIA_PROVIDER: "mock" })).toBe("mock");
    expect(providerIdFromEnv({})).toBe("claude-code");
    expect(createProviderFromEnv({ NARNIA_PROVIDER: "mock" }).id).toBe("mock");
    expect(createProviderFromEnv({ NARNIA_PROVIDER: "claude-code" }).id).toBe("claude-code");
  });
});

describe("M7/providers MockProvider: modo compartilhado por arquivo (api e worker são processos distintos)", () => {
  it("setMode em uma instância é visto por outra que aponta para o mesmo arquivo; reset volta aos padrões", async () => {
    const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "narnia-mock-"));
    const file = join(dir, "sub", ".mock-mode.json");
    try {
      const api = new MockProvider({ modeFile: file });
      const worker = new MockProvider({ modeFile: file });
      api.setMode({ loggedIn: false });
      expect((await worker.detect()).loggedIn).toBe(false);
      api.setMode({ loggedIn: true, authMethod: "oauth_token", errors: { extractFacts: "boom" } });
      expect((await worker.detect()).authMethod).toBe("oauth_token");
      await expect(
        worker.extractFacts({ text: "x".repeat(300), locale: "pt-BR", model: "haiku" }),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(existsSync(file)).toBe(true);
      api.reset();
      expect(worker.getMode()).toMatchObject({ loggedIn: true, authMethod: "claude.ai", delayMs: 0, errors: {} });
      await expect(
        worker.extractFacts({ text: "x".repeat(300), locale: "pt-BR", model: "haiku" }),
      ).resolves.toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("arquivo ausente ou corrompido não quebra: usa o modo em memória", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "narnia-mock-"));
    try {
      const file = join(dir, ".mock-mode.json");
      const p = new MockProvider({ modeFile: file, loggedIn: false });
      expect((await p.detect()).loggedIn).toBe(false);
      writeFileSync(file, "{ isto não é json");
      expect((await p.detect()).loggedIn).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createProviderFromEnv liga o mock ao arquivo de modo dentro de NARNIA_DATA_DIR", async () => {
    const { createProviderFromEnv } = await import("../src/index");
    const p = createProviderFromEnv({ NARNIA_PROVIDER: "mock", NARNIA_DATA_DIR: "/tmp/narnia-x" });
    expect(p).toBeInstanceOf(MockProvider);
    expect((p as MockProvider).modeFile).toBe("/tmp/narnia-x/.mock-mode.json");
    const semDir = createProviderFromEnv({ NARNIA_PROVIDER: "mock" });
    expect((semDir as MockProvider).modeFile).toBeNull();
  });
});
