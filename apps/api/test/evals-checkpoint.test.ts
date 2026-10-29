import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvalCases } from "@narnia-jobs/core";
import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isUsageLimit, limitConcurrency, openCheckpoint } from "../src/evals/checkpoint";
import { type EvalCaseReport, EvalRunAborted, runEvalCases } from "../src/evals/run";

const report = (id: string, over: Partial<EvalCaseReport> = {}): EvalCaseReport => ({
  id,
  passed: true,
  results: [],
  sessionId: `s-${id}`,
  startedAt: "2026-10-28T12:00:00.000Z",
  endedAt: "2026-10-28T12:01:00.000Z",
  replies: [`resposta de ${id}`],
  tools: [],
  ...over,
});

const completion = (text: string): CompleteResult => ({
  text,
  structured: { label: "atende", explanation: text },
  model: "claude-haiku",
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "claude-haiku",
  },
  costUsd: 0,
});

/**
 * Gate do chat que retoma (pedido do dono, 2026-10-28): o limite de uso da assinatura derrubou três rodadas de ~4 h
 * no meio e nada foi aproveitado. Cada conversa e cada julgamento ficam num arquivo assim que terminam; a rodada
 * seguinte com os mesmos prompts, casos e opções retoma de onde parou, e o primeiro erro do modelo para a rodada.
 */
describe("gate do chat · retomada depois do limite de uso", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const file = () => {
    dir = mkdtempSync(join(tmpdir(), "narnia-cp-"));
    return join(dir, "chat.json");
  };

  it("guarda as conversas terminadas e as devolve ao reabrir com a mesma chave", () => {
    const path = file();
    const cp = openCheckpoint(path, "chave-1");
    cp.putRun("amostra-2:pontos-fracos", report("pontos-fracos"));
    cp.putRun("amostra-2:salario", report("salario", { error: "não respondeu" }));
    const again = openCheckpoint(path, "chave-1");
    expect(again.getRun("amostra-2:pontos-fracos")?.replies).toEqual(["resposta de pontos-fracos"]);
    // conversa com erro não vale: roda de novo na retomada
    expect(again.getRun("amostra-2:salario")).toBeUndefined();
    expect(again.resumed).toEqual({ runs: 1, completions: 0, values: 0 });
  });

  it("chave diferente (prompt, caso ou opção mudou) ou --fresh começa do zero", () => {
    const path = file();
    openCheckpoint(path, "chave-1").putRun("1:a", report("a"));
    expect(openCheckpoint(path, "chave-2").getRun("1:a")).toBeUndefined();
    openCheckpoint(path, "chave-2").putRun("1:a", report("a"));
    expect(openCheckpoint(path, "chave-2", { fresh: true }).getRun("1:a")).toBeUndefined();
  });

  it("julgamento já feito (juiz e pairwise) vem do arquivo, sem chamar o modelo de novo", async () => {
    const path = file();
    const complete = vi.fn(async (i: CompleteInput) => completion(i.prompt));
    const judge = openCheckpoint(path, "k").memo({ complete });
    const input: CompleteInput = { system: "juiz", prompt: "compare A e B", model: "haiku" };
    expect((await judge.complete(input)).text).toBe("compare A e B");
    const again = openCheckpoint(path, "k");
    expect(again.resumed.completions).toBe(1);
    expect((await again.memo({ complete }).complete(input)).structured).toEqual({
      label: "atende",
      explanation: "compare A e B",
    });
    expect(complete).toHaveBeenCalledTimes(1);
    // outra entrada (a ordem trocada do pairwise) chama o modelo
    await again.memo({ complete }).complete({ ...input, prompt: "compare B e A" });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("clear apaga o arquivo (a rodada gravou a linha de base)", () => {
    const path = file();
    const cp = openCheckpoint(path, "k");
    cp.putRun("1:a", report("a"));
    expect(existsSync(path)).toBe(true);
    cp.clear();
    expect(existsSync(path)).toBe(false);
  });

  it("reconhece o erro do limite de uso da assinatura", () => {
    expect(isUsageLimit("Claude Code returned an error result: You've hit your usage limit")).toBe(
      true,
    );
    expect(isUsageLimit("You've hit your session limit · resets 7:10pm (UTC)")).toBe(true);
    expect(isUsageLimit("a conversa s1 não respondeu em 180000 ms")).toBe(false);
  });
});

describe("juiz com poucas chamadas ao mesmo tempo", () => {
  // o pairwise julga casos × amostras × 2 ordens de uma vez (~150 processos do Claude Code): o limite de taxa da
  // assinatura respondia "usage limit" com a cota em 45% (2026-10-28)
  it("nunca passa de N chamadas simultâneas e devolve cada resultado na ordem certa", async () => {
    let running = 0;
    let peak = 0;
    const slow = {
      complete: async (i: CompleteInput) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return completion(i.prompt);
      },
    };
    const judge = limitConcurrency(slow, 3);
    const out = await Promise.all(
      Array.from({ length: 20 }, (_, k) =>
        judge.complete({ system: "s", prompt: `p${k}`, model: "m" }),
      ),
    );
    expect(peak).toBe(3);
    expect(out.map((r) => r.text)).toEqual(Array.from({ length: 20 }, (_, k) => `p${k}`));
  });
});

describe("runner do chat · erro do turno e parada no primeiro erro", () => {
  const cases = parseEvalCases(
    [
      '{"id":"um","messages":["oi"],"graders":[{"type":"asks_question"}]}',
      '{"id":"dois","messages":["oi de novo"],"graders":[{"type":"asks_question"}]}',
    ].join("\n"),
  );
  // API sem resposta do recrutador: a mensagem entra e o assistente nunca responde
  const silent = (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const json = (body: unknown) => Promise.resolve(Response.json(body));
    if (path === "/api/sessions" && init?.method === "POST")
      return json({ session: { id: `s${Math.random()}` } });
    if (path.endsWith("/messages") && init?.method === "POST") return json({});
    if (path.endsWith("/messages")) return json({ messages: [] });
    if (path.endsWith("/hibernate")) return json({});
    return Promise.resolve(new Response("não", { status: 404 }));
  };

  it("o turno que falhou na sessão (limite de uso) vira erro na hora, sem esperar o tempo do turno", async () => {
    const t0 = Date.now();
    const [r] = await runEvalCases(cases.slice(0, 1), {
      baseUrl: "http://narnia.test",
      token: "t",
      fetch: silent,
      turnTimeoutMs: 60_000,
      turnError: () => "You've hit your usage limit",
    });
    expect(r?.error).toContain("usage limit");
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("com stopOnError, o primeiro erro para a rodada; as conversas terminadas já foram entregues", async () => {
    const done: string[] = [];
    const run = runEvalCases(cases, {
      baseUrl: "http://narnia.test",
      token: "t",
      fetch: silent,
      turnTimeoutMs: 50,
      stopOnError: true,
      onCase: (r) => done.push(r.id),
    });
    await expect(run).rejects.toBeInstanceOf(EvalRunAborted);
    await expect(run).rejects.toThrow(/um: a conversa .* não respondeu/);
    // o caso "dois" não rodou
    expect(done).toEqual(["um"]);
  });
});
