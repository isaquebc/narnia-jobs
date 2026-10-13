import { existsSync } from "node:fs";
import { parseEvalCases } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { runEvalCases } from "../src/evals/run";
import { type EvalSandbox, openEvalSandbox } from "../src/evals/sandbox";
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
});
