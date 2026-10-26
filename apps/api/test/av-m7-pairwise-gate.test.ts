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

  it("--samples=N e --noise entram nas flags (só quando passados)", () => {
    expect(gateFlags(["--gate", "--samples=3"])).toMatchObject({ gate: true, samples: 3 });
    expect(gateFlags(["--noise"])).toMatchObject({ noise: true });
    expect(gateFlags(["--samples=0"]).samples).toBeUndefined();
  });

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

/** Juiz pelo conteúdo da candidata: "GANHA" vence, "PERDE" perde, o resto empata. */
function contentJudge() {
  let calls = 0;
  const provider = {
    complete: async (i: CompleteInput): Promise<CompleteResult> => {
      calls++;
      const candidateFirst = i.prompt.indexOf("candidata") < i.prompt.indexOf("aprovada");
      const verdict = i.prompt.includes("GANHA") ? 1 : i.prompt.includes("PERDE") ? -1 : 0;
      const candidatePos = candidateFirst ? "A" : "B";
      const other = candidateFirst ? "B" : "A";
      const vencedor = verdict > 0 ? candidatePos : verdict < 0 ? other : "empate";
      return {
        text: "",
        structured: { vencedor, explicacao: "" },
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

describe("gate robusto (2026-10-25) · casos afetados, amostras e ruído", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const KEY = "narnia-chat";
  function setup(approved: ApprovedCase[], baselines?: Record<string, unknown>) {
    const d = mkdtempSync(join(tmpdir(), "narnia-robusto-"));
    dirs.push(d);
    const path = join(d, "baselines.json");
    mkdirSync(join(d, "approved"));
    const file = join(d, "approved", `${KEY}.jsonl`);
    writeFileSync(file, serializeApproved(approved));
    if (baselines) writeFileSync(path, JSON.stringify(baselines));
    return { path, file };
  }
  const approvedWith = (id: string, deps: Record<string, string>) => ({
    ...approvedCase(id, "v1"),
    deps,
  });
  const candidateRun = (id: string, deps: Record<string, string>, ...texts: string[]) => ({
    ...run(id, `candidata ${texts[0] ?? ""}`),
    deps,
    samples: texts.slice(1).map((t) => out(`candidata ${t}`)),
  });
  const BASE = { "narnia-recrutador": "r1" };
  const FORM = { ...BASE, "narnia-skill-responder-candidatura": "s1" };
  const FORM2 = { ...BASE, "narnia-skill-responder-candidatura": "s2" };

  it("só compara os casos cujas dependências mudaram; os outros mantêm a aprovada", async () => {
    const { path, file } = setup([approvedWith("vaga", BASE), approvedWith("form", FORM)]);
    const j = contentJudge();
    const g = new BaselineGate({ gate: true, update: true, fixes: [] }, path);
    const r = await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider: j.provider,
      runs: [candidateRun("vaga", BASE, "PERDE"), candidateRun("form", FORM2, "GANHA")],
    });
    expect(r.status).toBe("comparado");
    expect(r.cases.map((c) => [c.exampleId, c.outcome])).toEqual([["form", "ganhou"]]);
    expect(r.skipped).toEqual(["vaga"]);
    expect(j.calls()).toBe(2);
    expect(g.finish(() => undefined)).toBe(false);
    const saved = parseApproved(readFileSync(file, "utf8"));
    expect(saved.find((c) => c.exampleId === "vaga")?.output).toEqual(out("aprovada vaga"));
    expect(saved.find((c) => c.exampleId === "form")?.deps).toEqual(FORM2);
  });

  it("nenhum caso afetado: igual, sem juiz; caso novo entra na aprovada com --update-baseline", async () => {
    const { path, file } = setup([approvedWith("vaga", BASE)]);
    const j = contentJudge();
    const g = new BaselineGate({ gate: true, update: true, fixes: [] }, path);
    const r = await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider: j.provider,
      runs: [candidateRun("vaga", BASE, "x"), candidateRun("novo", FORM, "y")],
    });
    expect(r.status).toBe("igual");
    expect(j.calls()).toBe(0);
    expect(g.finish(() => undefined)).toBe(false);
    expect(parseApproved(readFileSync(file, "utf8")).map((c) => [c.exampleId, c.output])).toEqual([
      ["novo", out("candidata y")],
      ["vaga", out("aprovada vaga")],
    ]);
  });

  it("aprovada sem dependências registradas (arquivo antigo): o caso conta como mudado", async () => {
    const { path } = setup([approvedCase("vaga", "v1")]);
    const g = new BaselineGate({ gate: true, update: false, fixes: [] }, path);
    const r = await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider: contentJudge().provider,
      runs: [candidateRun("vaga", BASE, "GANHA")],
    });
    expect(r.cases.map((c) => c.outcome)).toEqual(["ganhou"]);
  });

  it("várias amostras: o caso vale pela maioria (uma vitória de sorte não decide)", async () => {
    const { path } = setup([approvedWith("a", FORM), approvedWith("b", FORM)]);
    const j = contentJudge();
    const g = new BaselineGate({ gate: true, update: false, fixes: [] }, path);
    const r = await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider: j.provider,
      runs: [
        candidateRun("a", FORM2, "GANHA", "x", "PERDE"),
        candidateRun("b", FORM2, "GANHA", "GANHA", "x"),
      ],
    });
    expect(j.calls()).toBe(12);
    expect(r.cases.map((c) => [c.exampleId, c.outcome])).toEqual([
      ["a", "empate"],
      ["b", "ganhou"],
    ]);
    expect(r.cases[0]?.explanation).toMatch(/3 amostras: 1 vitória, 1 derrota, 1 empate/);
    // o placar soma as amostras (decisão do dono 2026-10-26), não a maioria por caso
    expect(r.decision).toMatchObject({ wins: 3, losses: 1, ties: 2 });
  });

  it("amostras novas da versão aprovada (against): cada amostra da candidata contra a sua par, não contra a guardada", async () => {
    const { path } = setup([approvedWith("a", FORM)]);
    const prompts: string[] = [];
    const j = contentJudge();
    const provider = {
      complete: (i: CompleteInput) => {
        prompts.push(i.prompt);
        return j.provider.complete(i);
      },
    };
    const g = new BaselineGate({ gate: true, update: false, fixes: [] }, path);
    const r = await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider,
      runs: [
        {
          ...candidateRun("a", FORM2, "GANHA", "GANHA"),
          against: [out("aprovada nova 1"), out("aprovada nova 2")],
        },
      ],
    });
    expect(r.cases[0]?.outcome).toBe("ganhou");
    expect(prompts.some((p) => p.includes("aprovada nova 1"))).toBe(true);
    expect(prompts.some((p) => p.includes("aprovada nova 2"))).toBe(true);
    expect(prompts.some((p) => p.includes("aprovada a"))).toBe(false);
  });

  it("margem pelo ruído medido: 2 vitórias contra 1 derrota não bastam com ruído alto", async () => {
    const approved = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) =>
      approvedWith(id, FORM),
    );
    const { path } = setup(approved, {
      [`ruido:${KEY}`]: { scores: { decisivos_por_amostra: 1 }, updatedAt: "t" },
    });
    const g = new BaselineGate({ gate: true, update: false, fixes: [] }, path);
    const texts = ["GANHA", "GANHA", "PERDE", "x", "x", "x", "x", "x", "x"];
    const r = await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider: contentJudge().provider,
      runs: approved.map((a, i) => candidateRun(a.exampleId, FORM2, texts[i] as string)),
    });
    expect(r.decision).toMatchObject({ passed: false, wins: 2, losses: 1 });
    expect(r.decision?.reason).toMatch(/margem do ruído: 3/);
    expect(g.finish(() => undefined)).toBe(true);
  });

  it("--feature entra nas flags", () => {
    expect(gateFlags(["--gate", "--feature=n1,n2"]).feature).toEqual(["n1", "n2"]);
    expect(gateFlags(["--gate"]).feature).toBeUndefined();
  });

  it("--feature: caso antigo afetado pode perder dentro do ruído; casos novos passam e entram na aprovada", async () => {
    const { path, file } = setup([approvedWith("a", FORM), approvedWith("b", FORM)], {
      [`ruido:${KEY}`]: { scores: { decisivos_por_amostra: 0.8 }, updatedAt: "t" },
    });
    const g = new BaselineGate({ gate: true, update: true, fixes: [], feature: ["novo"] }, path);
    const r = await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider: contentJudge().provider,
      runs: [
        candidateRun("a", FORM2, "PERDE"),
        candidateRun("b", FORM2, "x"),
        candidateRun("novo", FORM2, "y"),
      ],
      features: [{ exampleId: "novo", passed: true, detail: "3 de 3 amostras" }],
    });
    expect(r.decision).toMatchObject({ passed: true, wins: 0, losses: 1 });
    expect(r.decision?.reason).toMatch(/não-inferior/);
    const log: string[] = [];
    expect(g.finish((l) => log.push(l))).toBe(false);
    expect(log.join("\n")).toMatch(/novo.*3 de 3 amostras/);
    expect(parseApproved(readFileSync(file, "utf8")).map((c) => c.exampleId)).toEqual([
      "a",
      "b",
      "novo",
    ]);
  });

  it("--feature por amostra: a margem conta os pares (casos × amostras) e o saldo soma as amostras", async () => {
    const attempt = async (a: string[], b: string[]) => {
      const { path } = setup([approvedWith("a", FORM), approvedWith("b", FORM)], {
        [`ruido:${KEY}`]: { scores: { decisivos_por_amostra: 0.5 }, updatedAt: "t" },
      });
      const g = new BaselineGate({ gate: true, update: false, fixes: [], feature: ["novo"] }, path);
      const r = await g.pairwise(KEY, {
        versionId: "v2",
        commit: "c2",
        judge,
        provider: contentJudge().provider,
        runs: [
          candidateRun("a", FORM2, ...a),
          candidateRun("b", FORM2, ...b),
          candidateRun("novo", FORM2, "y"),
        ],
        features: [{ exampleId: "novo", passed: true, detail: "5 de 5 amostras" }],
      });
      return r.decision;
    };
    // 10 pares com metade decidida pelo acaso: margem ⌈√5⌉ = 3
    expect(
      await attempt(["PERDE", "PERDE", "GANHA", "x", "x"], ["PERDE", "x", "x", "x", "GANHA"]),
    ).toMatchObject({ passed: true, wins: 2, losses: 3, ties: 5 });
    const bad = await attempt(
      ["PERDE", "PERDE", "PERDE", "PERDE", "x"],
      ["PERDE", "PERDE", "x", "x", "x"],
    );
    expect(bad).toMatchObject({ passed: false, wins: 0, losses: 6 });
    expect(bad?.reason).toMatch(/margem: 3/);
  });

  it("--feature: caso novo reprovado, ausente ou que já tem aprovada reprova o gate", async () => {
    const { path } = setup([approvedWith("a", FORM)]);
    const attempt = async (
      feature: string[],
      features: Array<{ exampleId: string; passed: boolean; detail: string }>,
    ) => {
      const g = new BaselineGate({ gate: true, update: false, fixes: [], feature }, path);
      const r = await g.pairwise(KEY, {
        versionId: "v2",
        commit: "c2",
        judge,
        provider: contentJudge().provider,
        runs: [candidateRun("a", FORM, "x"), candidateRun("novo", FORM2, "y")],
        features,
      });
      return { r, failed: g.finish(() => undefined) };
    };
    const bad = await attempt(["novo"], [{ exampleId: "novo", passed: false, detail: "1 de 3" }]);
    expect(bad.failed).toBe(true);
    expect(bad.r.decision?.reason).toMatch(/caso novo reprovado: novo/);
    expect((await attempt(["sumiu"], [])).r.decision?.reason).toMatch(/não rodou: sumiu/);
    expect(
      (await attempt(["a"], [{ exampleId: "a", passed: true, detail: "" }])).r.decision?.reason,
    ).toMatch(/já tem aprovada: a/);
  });

  it("A contra A: mede a fração de casos que o acaso decide nos casos sem mudança e grava como ruído", async () => {
    const { path } = setup([
      approvedWith("a", BASE),
      approvedWith("b", BASE),
      approvedWith("c", FORM),
    ]);
    const g = new BaselineGate({ gate: false, update: false, fixes: [] }, path);
    const noise = await g.measureNoise(KEY, {
      judge,
      provider: contentJudge().provider,
      runs: [
        candidateRun("a", BASE, "GANHA", "GANHA", "x"),
        candidateRun("b", BASE, "GANHA", "x", "PERDE"),
        candidateRun("c", FORM2, "GANHA"),
      ],
      spreads: { "chat:juiz": 0.09, "chat:avaliadores": 0.02 },
    });
    // por amostra: 3 vitórias e 1 derrota em 6 pares
    expect(noise).toMatchObject({ cases: 2, samples: 3, pairs: 6 });
    expect(noise.decisiveRate).toBeCloseTo(4 / 6);
    const log: string[] = [];
    expect(g.finish((l) => log.push(l))).toBe(false);
    expect(log.join("\n")).toMatch(/Ruído de narnia-chat.*4 de 6 pares/);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved[`ruido:${KEY}`].scores).toMatchObject({
      amostras: 3,
      casos: 2,
      pares: 6,
      "chat:avaliadores": 0.02,
      "chat:juiz": 0.09,
    });
    expect(saved[`ruido:${KEY}`].scores.decisivos_por_amostra).toBeCloseTo(4 / 6);
    expect(saved[`ruido:${KEY}`].scores.decisivos).toBeUndefined();
  });

  it("a tolerância da nota média cresce com o ruído medido", () => {
    const { path } = setup([], {
      "chat:juiz": { scores: { media: 0.73 }, updatedAt: "t" },
      [`ruido:${KEY}`]: { scores: { "chat:juiz": 0.1 }, updatedAt: "t" },
    });
    const g = new BaselineGate({ gate: true, update: false, fixes: [] }, path);
    expect(g.record("chat:juiz", { media: 0.67 })).toEqual([]);
    expect(g.record("chat:juiz", { media: 0.6 })).toHaveLength(1);
  });
});

/**
 * Aprovação do dono (2026-10-26): quando o gate reprova e o dono aprova explicitamente na conversa, `--owner-approved`
 * grava a linha de base e as versões aprovadas mesmo com regressão ou sem upgrade (com o motivo no log). Rodada
 * incompleta continua sem gravar nada.
 */
describe("aprovação do dono (--owner-approved)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const KEY = "narnia-application-roleplay";
  const setup = () => {
    const d = mkdtempSync(join(tmpdir(), "narnia-dono-"));
    dirs.push(d);
    mkdirSync(join(d, "approved"));
    writeFileSync(
      join(d, "approved", `${KEY}.jsonl`),
      serializeApproved([approvedCase("a", "v1")]),
    );
    const path = join(d, "baselines.json");
    writeFileSync(path, JSON.stringify({ [KEY]: { scores: { padrao: 1 }, updatedAt: "t" } }));
    return { path, file: join(d, "approved", `${KEY}.jsonl`) };
  };

  it("entra nas flags só quando passada", () => {
    expect(gateFlags(["--update-baseline", "--owner-approved"]).ownerApproved).toBe(true);
    expect(gateFlags(["--update-baseline"]).ownerApproved).toBeUndefined();
  });

  it("com regressão e sem upgrade, grava linha de base e aprovada e diz o que foi aprovado apesar do gate", async () => {
    const { path, file } = setup();
    const g = new BaselineGate({ gate: true, update: true, fixes: [], ownerApproved: true }, path);
    g.record(KEY, { padrao: 0.86 }, { versionId: "v2" });
    await g.pairwise(KEY, {
      versionId: "v2",
      commit: "c2",
      judge,
      provider: contentJudge().provider,
      runs: [run("a", "candidata PERDE")],
    });
    const log: string[] = [];
    expect(g.finish((l) => log.push(l))).toBe(false);
    expect(log.join("\n")).toMatch(/Aprovado pelo dono apesar de/);
    expect(JSON.parse(readFileSync(path, "utf8"))[KEY].scores).toEqual({ padrao: 0.86 });
    expect(parseApproved(readFileSync(file, "utf8"))[0]?.versionId).toBe("v2");
  });

  it("rodada incompleta não grava, nem com a aprovação do dono", () => {
    const { path } = setup();
    const g = new BaselineGate({ gate: true, update: true, fixes: [], ownerApproved: true }, path);
    g.record(KEY, { padrao: 0.9 }, { versionId: "v2", errors: 1 });
    expect(g.finish(() => undefined)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))[KEY].scores).toEqual({ padrao: 1 });
  });
});
