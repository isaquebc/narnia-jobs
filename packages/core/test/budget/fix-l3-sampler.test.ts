import { describe, expect, it } from "vitest";
import { createPlanSampler, type LearnSample, learnPctToTokens } from "../../src/budget/learn";

/** Plano de correções F03, item 11: amostra %→tokens por chamada, sem contaminação. */
describe("F03 fix L3 · item 11: aprendizado por chamada", () => {
  it("descarta amostra quando a janela renovou no meio (resetsAt mudou)", () => {
    const s: LearnSample = {
      model: "sonnet",
      utilizationBefore: 10,
      utilizationAfter: 12,
      tokens: 20_000,
      resetsBefore: "2026-10-10T15:00:00Z",
      resetsAfter: "2026-10-10T20:00:00Z",
    };
    expect(learnPctToTokens({}, s)).toEqual({});
  });

  it("descarta amostra marcada como concorrente", () => {
    const s: LearnSample = {
      model: "sonnet",
      utilizationBefore: 10,
      utilizationAfter: 12,
      tokens: 20_000,
      overlapped: true,
    };
    expect(learnPctToTokens({}, s)).toEqual({});
  });

  it("sampler atribui cada chamada ao seu modelo, lendo a janela antes e depois", async () => {
    let utilization = 10;
    const samples: LearnSample[] = [];
    const sampler = createPlanSampler({
      snapshot: () => ({ utilization, resetsAt: "2026-10-10T15:00:00Z" }),
      record: (s) => samples.push(s),
    });
    await sampler.track(
      "haiku",
      async () => {
        utilization += 1;
        return 5_000;
      },
      (n) => n,
    );
    await sampler.track(
      "sonnet",
      async () => {
        utilization += 2;
        return 30_000;
      },
      (n) => n,
    );
    expect(
      samples.map((s) => [
        s.model,
        s.utilizationAfter - s.utilizationBefore,
        s.tokens,
        s.overlapped,
      ]),
    ).toEqual([
      ["haiku", 1, 5_000, false],
      ["sonnet", 2, 30_000, false],
    ]);
  });

  it("chamadas sobrepostas viram amostras marcadas como concorrentes", async () => {
    let utilization = 0;
    const samples: LearnSample[] = [];
    const sampler = createPlanSampler({
      snapshot: () => ({ utilization, resetsAt: "r" }),
      record: (s) => samples.push(s),
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const a = sampler.track(
      "haiku",
      async () => {
        await gate;
        utilization += 1;
        return 1_000;
      },
      (n) => n,
    );
    const b = sampler.track(
      "haiku",
      async () => {
        utilization += 1;
        release();
        return 1_000;
      },
      (n) => n,
    );
    await Promise.all([a, b]);
    expect(samples.every((s) => s.overlapped)).toBe(true);
  });
});
