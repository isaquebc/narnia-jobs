import { existsSync } from "node:fs";
import { factIds, knownFactsText, parseEvalCases } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { savedPostingsText } from "../src/evals/cli-evals";
import { runEvalCases } from "../src/evals/run";
import { type EvalSandbox, openEvalSandbox, withEvalSandbox } from "../src/evals/sandbox";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * M5 (decisão AV-3 revista): avaliações do recrutador num banco temporário isolado, com `/mcp` e token próprios
 * servidos em 127.0.0.1; os dados do usuário nunca entram. Fecha e apaga tudo no fim.
 */
describe("sandbox de avaliação", () => {
  let sb: EvalSandbox | undefined;
  let owner: TestApp | undefined;
  afterEach(async () => {
    await sb?.close();
    owner?.cleanup();
  });

  it("conversa de referência roda no banco descartável pelo /mcp HTTP dele, sem tocar no banco do usuário", async () => {
    owner = makeTestApp();
    const before = owner.repos.chatSessions.list({}).length;
    sb = await openEvalSandbox({ provider: new MockProvider() });
    expect(sb.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(existsSync(sb.dir)).toBe(true);
    const cases = parseEvalCases(
      '{"id":"pontos-fracos","messages":["o que está fraco no meu perfil?"],"graders":[{"type":"uses_tool","value":"evidence_experience_list"}]}',
    );
    const [r] = await runEvalCases(cases, {
      baseUrl: sb.baseUrl,
      token: sb.token,
      turnTimeoutMs: 10000,
    });
    expect(r?.passed).toBe(true);
    expect(sb.repos.chatSessions.list({}).length).toBe(1);
    expect(owner.repos.chatSessions.list({}).length).toBe(before);
  }, 20_000);

  it("caso com open: document_feedback abre pela rota do feedback, sobre o CV pronto da vaga do sandbox", async () => {
    sb = await openEvalSandbox({ provider: new MockProvider() });
    const docs = sb.repos.documents.list({ kind: "cv" });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.postingId).not.toBeNull();
    expect(sb.repos.documents.currentVersion(docs[0]?.id ?? "")).toMatchObject({ status: "ready" });
    const cases = parseEvalCases(
      '{"id":"feedback","category":"job","open":"document_feedback","messages":["encurte o resumo"],"graders":[{"type":"within_budget","value":"80000"}]}',
    );
    const [r] = await runEvalCases(cases, {
      baseUrl: sb.baseUrl,
      token: sb.token,
      turnTimeoutMs: 10000,
    });
    expect(r?.error ?? null).toBeNull();
    const [session] = sb.repos.chatSessions.list({});
    expect(session?.postingId).toBe(docs[0]?.postingId);
    expect(session?.title).toContain("· CV");
  }, 20_000);

  it("document_feedback usa o CV pronto da vaga mesmo com outro CV em geração (deixado por um caso anterior)", async () => {
    sb = await openEvalSandbox({ provider: new MockProvider() });
    const [seeded] = sb.repos.documents.list({ kind: "cv" });
    const busy = sb.repos.documents.create({
      kind: "cv",
      profileId: seeded?.profileId ?? "",
      postingId: null,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    sb.repos.documents.addVersion(busy.id, {
      source: "agent",
      instructions: null,
      factsVersion: sb.repos.settings.getFactsVersion(),
      postingUpdatedAt: null,
      profileHash: "x",
    });
    const cases = parseEvalCases(
      '{"id":"feedback","category":"job","open":"document_feedback","messages":["encurte o resumo"],"graders":[{"type":"within_budget","value":"80000"}]}',
    );
    const [r] = await runEvalCases(cases, {
      baseUrl: sb.baseUrl,
      token: sb.token,
      turnTimeoutMs: 10000,
    });
    expect(r?.error ?? null).toBeNull();
    expect(sb.repos.chatSessions.list({})[0]?.postingId).toBe(seeded?.postingId);
  }, 20_000);

  it("amostra seguinte (gate robusto): o CV da vaga com versão na fila (cv_edit sem worker) volta à versão pronta", async () => {
    sb = await openEvalSandbox({ provider: new MockProvider() });
    const [seeded] = sb.repos.documents.list({ kind: "cv" });
    sb.repos.documents.addVersion(seeded?.id ?? "", {
      source: "edit",
      instructions: null,
      factsVersion: sb.repos.settings.getFactsVersion(),
      postingUpdatedAt: null,
      profileHash: "x",
    });
    expect(sb.repos.documents.currentVersion(seeded?.id ?? "")?.status).not.toBe("ready");
    const cases = parseEvalCases(
      '{"id":"feedback","category":"job","open":"document_feedback","messages":["encurte o resumo"],"graders":[{"type":"within_budget","value":"80000"}]}',
    );
    const [r] = await runEvalCases(cases, {
      baseUrl: sb.baseUrl,
      token: sb.token,
      turnTimeoutMs: 10000,
      readyPostingCv: () => sb?.readyPostingCv(),
    });
    expect(r?.error ?? null).toBeNull();
  }, 20_000);

  it("formulário novo começa sem autodeclaração (a amostra anterior guardou uma e o caso seguinte não perguntava)", async () => {
    sb = await openEvalSandbox({ provider: new MockProvider() });
    sb.repos.selfDeclarations.set("race", "Parda");
    sb.newApplication();
    expect(sb.repos.selfDeclarations.list()).toEqual([]);
  });

  it("o /mcp do sandbox exige o token dele; fechar apaga a pasta e derruba o servidor", async () => {
    sb = await openEvalSandbox({ provider: new MockProvider() });
    const noToken = await fetch(`${sb.baseUrl}/api/profiles`);
    expect(noToken.status).toBe(401);
    const ok = await fetch(`${sb.baseUrl}/api/profiles`, {
      headers: { authorization: `Bearer ${sb.token}` },
    });
    expect(ok.status).toBe(200);
    const { dir, baseUrl } = sb;
    await sb.close();
    sb = undefined;
    expect(existsSync(dir)).toBe(false);
    await expect(fetch(`${baseUrl}/api/health`)).rejects.toThrow();
  });

  it("cada rodada de amostras num sandbox novo: o que uma criou não aparece na seguinte, e fecha mesmo com erro", async () => {
    // noise-4 (2026-10-26): no mesmo sandbox, as vagas e as conversas acumulavam entre as rodadas, e o lado A (que roda
    // por último) via "9 vagas duplicadas" e o limite de conversas abertas
    const dirs: string[] = [];
    const counts: number[] = [];
    for (let k = 0; k < 2; k++)
      await withEvalSandbox({ provider: new MockProvider() }, async (s) => {
        dirs.push(s.dir);
        counts.push(s.repos.postings.list().length);
        s.repos.postings.create({ company: "Initech", role: "backend", title: "Dev", jdText: "x" });
      });
    expect(counts[0]).toBe(counts[1]);
    expect(dirs[0]).not.toBe(dirs[1]);
    expect(dirs.some((d) => existsSync(d))).toBe(false);
    let dir = "";
    await expect(
      withEvalSandbox({ provider: new MockProvider() }, async (s) => {
        dir = s.dir;
        throw new Error("falhou");
      }),
    ).rejects.toThrow("falhou");
    expect(existsSync(dir)).toBe(false);
  }, 20_000);
  it("R5: a fixture tem os mesmos ids em todo sandbox (o juiz vê o índice de uma amostra e confere as citações de todas)", async () => {
    const snap = async (s: EvalSandbox) => {
      const card = await fetch(`${s.baseUrl}/api/profiles/active/persona-card`, {
        headers: { authorization: `Bearer ${s.token}` },
      }).then((r) => r.json() as Promise<{ text: string }>);
      return {
        ids: factIds(s.repos),
        postings: s.repos.postings.list().map((p) => p.id),
        facts: knownFactsText(s.repos),
        saved: savedPostingsText(s.repos),
        card: card.text,
      };
    };
    const a = await withEvalSandbox({ provider: new MockProvider() }, snap);
    const b = await withEvalSandbox({ provider: new MockProvider() }, snap);
    expect(a.ids.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(a.card).toMatch(/f:[0-9a-f]{6,}/);
    // o que a conversa cria depois do preparo continua com ids novos (só a fixture é fixa)
    const c = await withEvalSandbox({ provider: new MockProvider() }, async (s) =>
      s.newApplication(),
    );
    const d = await withEvalSandbox({ provider: new MockProvider() }, async (s) =>
      s.newApplication(),
    );
    expect(c).not.toBe(d);
  }, 30_000);
});
