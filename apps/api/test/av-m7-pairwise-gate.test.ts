import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ApprovedCase, parseApproved, serializeApproved } from "@narnia-jobs/core";
import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { BaselineGate, gateFlags } from "../src/evals/baseline-file";
import { judgeFor } from "../src/evals/judges";

/**
 * M7 (AV-5, AV-6) · gate pairwise: compara com a versão aprovada só quando o prompt mudou; sem aprovada é a primeira
 * aprovação; `--update-baseline` grava `evals/approved/<prompt>.jsonl` só quando nada reprovou.
 */
const judge = judgeFor("chatTitle");
const out = (content: string) => ({ messages: [{ role: "assistant", content }] });
const run = (exampleId: string, content: string) => ({
  exampleId,
  ctx: { input: { message: `msg-${exampleId}` } },
  output: out(content),
  evaluations: [
    { name: "json_schema", kind: "CODE" as const, label: "passou", score: 1, explanation: "" },
  ],
});
const approvedCase = (exampleId: string, versionId = "v1"): ApprovedCase => ({
  exampleId,
  versionId,
  commit: "aaa1111",
  approvedAt: "2026-10-20T00:00:00Z",
  output: out(`aprovada ${exampleId}`),
  evaluations: [],
});

/** Juiz roteirizado: a candidata vence (B na 1ª ordem, A na 2ª) nos ids de `wins`, perde nos de `losses`. */
function judgeProvider(wins: string[], losses: string[] = []) {
  let calls = 0;
  const provider = {
    complete: async (i: CompleteInput): Promise<CompleteResult> => {
      calls++;
      const id = /msg-(\w+)/.exec(i.prompt)?.[1] ?? "";
      const candidateFirst = i.prompt.indexOf("candidata") < i.prompt.indexOf("aprovada");
      const vencedor = wins.includes(id)
        ? candidateFirst
          ? "A"
          : "B"
        : losses.includes(id)
          ? candidateFirst
            ? "B"
            : "A"
          : "empate";
      return {
        text: "",
        structured: { vencedor, explicacao: id },
        model: "m",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "m",
        },
        costUsd: 0,
      };
    },
  };
  return { provider, calls: () => calls };
}

describe("M7 · gate pairwise", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function setup(approved?: ApprovedCase[]) {
    const d = mkdtempSync(join(tmpdir(), "narnia-pairwise-"));
    dirs.push(d);
    const baselines = join(d, "baselines.json");
    const file = join(d, "approved", "narnia-chat-title.jsonl");
    if (approved) {
      mkdirSync(join(d, "approved"));
      writeFileSync(file, serializeApproved(approved));
    }
    return { baselines, file };
  }
  const candidate = (ids: string[]) => ids.map((id) => run(id, `candidata ${id}`));

  it("--fixes=a,b entra nas flags", () => {
    expect(gateFlags(["--gate", "--fixes=c1,c2"])).toEqual({
      gate: true,
      update: false,
      fixes: ["c1", "c2"],
    });
  });

  it("sem versão aprovada: primeira aprovação, sem juiz; --update-baseline grava o arquivo", async () => {
    const { baselines, file } = setup();
    const j = judgeProvider([]);
    const g = new BaselineGate({ gate: true, update: true, fixes: [] }, baselines);
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "bbb2222",
      judge,
      provider: j.provider,
      runs: candidate(["a", "b"]),
    });
    expect(r.status).toBe("primeira");
    expect(j.calls()).toBe(0);
    expect(g.finish(() => undefined)).toBe(false);
    const saved = parseApproved(readFileSync(file, "utf8"));
    expect(saved.map((c) => [c.exampleId, c.versionId, c.commit])).toEqual([
      ["a", "v2", "bbb2222"],
      ["b", "v2", "bbb2222"],
    ]);
    expect(saved[0]?.output).toEqual(out("candidata a"));
  });

  it("mesma versão da aprovada: não compara nem regrava", async () => {
    const { baselines, file } = setup([approvedCase("a", "v1")]);
    const before = readFileSync(file, "utf8");
    const j = judgeProvider([]);
    const g = new BaselineGate({ gate: true, update: true, fixes: [] }, baselines);
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v1",
      commit: "ccc",
      judge,
      provider: j.provider,
      runs: candidate(["a"]),
    });
    expect(r.status).toBe("igual");
    expect(j.calls()).toBe(0);
    expect(g.finish(() => undefined)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("versão nova que ganha mais do que perde: passa e vira a aprovada", async () => {
    const { baselines, file } = setup(["a", "b", "c"].map((id) => approvedCase(id)));
    const j = judgeProvider(["a", "b"], ["c"]);
    const g = new BaselineGate({ gate: true, update: true, fixes: [] }, baselines);
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "ddd",
      judge,
      provider: j.provider,
      runs: candidate(["a", "b", "c"]),
    });
    expect(r.status).toBe("comparado");
    expect(r.decision).toMatchObject({ passed: true, wins: 2, losses: 1 });
    expect(r.cases.find((c) => c.exampleId === "c")?.outcome).toBe("perdeu");
    expect(j.calls()).toBe(6);
    const log: string[] = [];
    expect(g.finish((l) => log.push(l))).toBe(false);
    expect(log.join("\n")).toMatch(/narnia-chat-title.*2 vitórias.*1 derrota/);
    expect(parseApproved(readFileSync(file, "utf8")).every((c) => c.versionId === "v2")).toBe(true);
  });

  it("só empates: reprova o gate e mantém a aprovada e a linha de base", async () => {
    const { baselines, file } = setup([approvedCase("a")]);
    const before = readFileSync(file, "utf8");
    const g = new BaselineGate({ gate: true, update: true, fixes: [] }, baselines);
    g.record("narnia-chat-title", { json_schema: 1 }, { versionId: "v2" });
    await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "eee",
      judge,
      provider: judgeProvider([]).provider,
      runs: candidate(["a"]),
    });
    const log: string[] = [];
    expect(g.finish((l) => log.push(l))).toBe(true);
    expect(log.join("\n")).toMatch(/não é upgrade/);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(baselines)).toBe(false);
  });

  it("--fixes: o caso corrigido precisa ser ganho e nenhum outro perdido", async () => {
    const { baselines } = setup(["a", "b"].map((id) => approvedCase(id)));
    const g = new BaselineGate({ gate: true, update: false, fixes: ["a"] }, baselines);
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "fff",
      judge,
      provider: judgeProvider(["a"]).provider,
      runs: candidate(["a", "b"]),
    });
    expect(r.decision?.passed).toBe(true);
    expect(g.finish(() => undefined)).toBe(false);
  });

  it("--seed-approved: grava a primeira aprovada mesmo com a nota oscilando, sem mexer na linha de base", async () => {
    expect(gateFlags(["--seed-approved"])).toEqual({
      gate: false,
      update: false,
      fixes: [],
      seed: true,
    });
    const { baselines, file } = setup();
    writeFileSync(
      baselines,
      JSON.stringify({ "narnia-chat-title": { scores: { padrao_de_entrega: 1 }, updatedAt: "x" } }),
    );
    const before = readFileSync(baselines, "utf8");
    const g = new BaselineGate(gateFlags(["--seed-approved"]), baselines);
    g.record("narnia-chat-title", { padrao_de_entrega: 0.8 }, { versionId: "v2" });
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "iii",
      judge,
      provider: judgeProvider([]).provider,
      runs: candidate(["a"]),
    });
    expect(r.status).toBe("primeira");
    const log: string[] = [];
    expect(g.finish((l) => log.push(l))).toBe(false);
    expect(log.join("\n")).toMatch(/Versão aprovada de narnia-chat-title gravada/);
    expect(parseApproved(readFileSync(file, "utf8")).map((c) => c.versionId)).toEqual(["v2"]);
    expect(readFileSync(baselines, "utf8")).toBe(before);
  });

  it("--seed-approved não regrava prompt que já tem aprovada nem grava rodada incompleta", async () => {
    const { baselines, file } = setup([approvedCase("a", "v1")]);
    const before = readFileSync(file, "utf8");
    const j = judgeProvider(["a"]);
    const g = new BaselineGate(gateFlags(["--seed-approved"]), baselines);
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "jjj",
      judge,
      provider: j.provider,
      runs: candidate(["a"]),
    });
    expect(r.status).toBe("pulado");
    expect(j.calls()).toBe(0);
    g.finish(() => undefined);
    expect(readFileSync(file, "utf8")).toBe(before);

    const fresh = setup();
    const g2 = new BaselineGate(gateFlags(["--seed-approved"]), fresh.baselines);
    g2.record("narnia-chat-title", { padrao_de_entrega: 1 }, { errors: 1 });
    await g2.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "kkk",
      judge,
      provider: judgeProvider([]).provider,
      runs: candidate(["a"]),
    });
    g2.finish(() => undefined);
    expect(existsSync(fresh.file)).toBe(false);
  });

  it("sem --gate nem --update-baseline o pairwise não roda (não gasta a assinatura)", async () => {
    const { baselines } = setup([approvedCase("a")]);
    const j = judgeProvider(["a"]);
    const g = new BaselineGate({ gate: false, update: false, fixes: [] }, baselines);
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "ggg",
      judge,
      provider: j.provider,
      runs: candidate(["a"]),
    });
    expect(r.status).toBe("pulado");
    expect(j.calls()).toBe(0);
  });

  it("caso sem par aprovado (caso novo no dataset) fica fora do placar; caso com erro também", async () => {
    const { baselines } = setup([approvedCase("a")]);
    const j = judgeProvider(["a"]);
    const g = new BaselineGate({ gate: true, update: false, fixes: [] }, baselines);
    const r = await g.pairwise("narnia-chat-title", {
      versionId: "v2",
      commit: "hhh",
      judge,
      provider: j.provider,
      runs: [...candidate(["a", "novo"]), { ...run("x", ""), error: "falhou" }],
    });
    expect(r.cases.map((c) => c.exampleId)).toEqual(["a"]);
    expect(j.calls()).toBe(2);
  });
});
