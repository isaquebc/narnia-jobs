import type { PlanUsage } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { BRAKE_FACTOR, brakeSummary, costToFinish, shouldBrake } from "../../src/budget/brake";
import { learnPctToTokens } from "../../src/budget/learn";
import { RECOMMEND_WINDOW_SHARE, recommendBudget } from "../../src/budget/recommend";
import { splitBudget } from "../../src/budget/split";
import { formatBudget, fromDisplay, toDisplay } from "../../src/budget/units";

const defaults = { quick: 15_000, balanced: 50_000, deep: 150_000 };
const plan = (fiveHour: number | null): PlanUsage => ({
  subscription: "max",
  source: "usage_api",
  windows: {
    fiveHour:
      fiveHour === null ? null : { utilization: fiveHour, resetsAt: "2026-10-09T18:00:00Z" },
    sevenDay: { utilization: 30, resetsAt: "2026-10-14T00:00:00Z" },
    perModel: [],
  },
});

describe("F03/M2 budget: recomendação, aprendizado, divisão, unidades e freio (F03-3)", () => {
  it("recomendado = min(padrão da profundidade, 70% do restante da janela de 5h em tokens)", () => {
    expect(RECOMMEND_WINDOW_SHARE).toBe(0.7);
    // restante 60% × 10k tokens/% = 600k; 70% = 420k > 150k → padrão
    expect(
      recommendBudget({
        depth: "deep",
        defaults,
        planUsage: plan(40),
        pctToTokens: { haiku: 10_000 },
        model: "haiku",
      }),
    ).toMatchObject({
      amount: 150_000,
      approximate: false,
      basis: "default",
      windowRemainingPct: 60,
      windowRemainingTokens: 600_000,
    });
    // restante 5% × 10k = 50k; 70% = 35k < 50k → janela
    expect(
      recommendBudget({
        depth: "balanced",
        defaults,
        planUsage: plan(95),
        pctToTokens: { haiku: 10_000 },
        model: "haiku",
      }),
    ).toMatchObject({
      amount: 35_000,
      basis: "window",
      approximate: false,
    });
  });

  it("sem dados do plano ou sem conversão aprendida → padrão e marca aproximado", () => {
    expect(
      recommendBudget({
        depth: "quick",
        defaults,
        planUsage: null,
        pctToTokens: {},
        model: "haiku",
      }),
    ).toMatchObject({
      amount: 15_000,
      approximate: true,
      basis: "default",
      windowRemainingTokens: null,
    });
    expect(
      recommendBudget({
        depth: "quick",
        defaults,
        planUsage: plan(40),
        pctToTokens: {},
        model: "haiku",
      }),
    ).toMatchObject({
      amount: 15_000,
      approximate: true,
      windowRemainingPct: 60,
      windowRemainingTokens: null,
    });
  });

  it("aprende % → tokens por modelo com média móvel; ignora amostra sem variação ou com janela renovada", () => {
    const first = learnPctToTokens(
      {},
      { model: "haiku", utilizationBefore: 10, utilizationAfter: 12, tokens: 20_000 },
    );
    expect(first).toEqual({ haiku: 10_000 });
    const second = learnPctToTokens(first, {
      model: "haiku",
      utilizationBefore: 12,
      utilizationAfter: 13,
      tokens: 20_000,
    });
    expect(second.haiku).toBe(13_000); // 0.7 × 10k + 0.3 × 20k
    expect(
      learnPctToTokens(first, {
        model: "haiku",
        utilizationBefore: 12,
        utilizationAfter: 12,
        tokens: 5_000,
      }),
    ).toEqual(first);
    expect(
      learnPctToTokens(first, {
        model: "haiku",
        utilizationBefore: 90,
        utilizationAfter: 3,
        tokens: 5_000,
      }),
    ).toEqual(first);
    expect(
      learnPctToTokens(first, {
        model: "sonnet",
        utilizationBefore: 1,
        utilizationAfter: 3,
        tokens: 8_000,
      }),
    ).toEqual({
      haiku: 10_000,
      sonnet: 4_000,
    });
  });

  it("divisão igual por repositório depois das reservas; sobra não é redistribuída", () => {
    const b = splitBudget({
      amount: 50_000,
      unit: "thousand",
      depth: "balanced",
      repoCount: 4,
      reserve: { synthesis: 6_000, check: 2_000 },
    });
    expect(b).toEqual({
      amount: 50_000,
      unit: "thousand",
      depth: "balanced",
      perRepo: 10_500,
      reserve: { synthesis: 6_000, check: 2_000 },
    });
    expect(
      splitBudget({
        amount: 5_000,
        unit: "thousand",
        depth: "quick",
        repoCount: 3,
        reserve: { synthesis: 6_000, check: 0 },
      }).perRepo,
    ).toBe(0);
    expect(() =>
      splitBudget({
        amount: 1,
        unit: "thousand",
        depth: "quick",
        repoCount: 0,
        reserve: { synthesis: 0, check: 0 },
      }),
    ).toThrow();
  });

  it("unidades: mil, milhão e % da janela (com conversão aprendida)", () => {
    expect(toDisplay(50_000, "thousand")).toBe(50);
    expect(toDisplay(2_500_000, "million")).toBe(2.5);
    expect(toDisplay(50_000, "window_pct", { pctToTokens: 10_000 })).toBe(5);
    expect(toDisplay(50_000, "window_pct", { pctToTokens: null })).toBeNull();
    expect(fromDisplay(50, "thousand")).toBe(50_000);
    expect(fromDisplay(1.5, "million")).toBe(1_500_000);
    expect(fromDisplay(5, "window_pct", { pctToTokens: 10_000 })).toBe(50_000);
    expect(fromDisplay(5, "window_pct", { pctToTokens: null })).toBeNull();
    expect(formatBudget(50_000, "thousand")).toBe("50 mil tokens");
    expect(formatBudget(2_500_000, "million")).toBe("2,5 milhões de tokens");
    expect(formatBudget(50_000, "window_pct", { pctToTokens: 10_000 })).toBe("5% da janela");
    expect(formatBudget(50_000, "window_pct", { pctToTokens: null })).toBe("50 mil tokens");
  });

  it("freio a 125% do orçamento", () => {
    expect(BRAKE_FACTOR).toBe(1.25);
    expect(shouldBrake({ amount: 40_000 }, 50_000)).toBe(false);
    expect(shouldBrake({ amount: 40_000 }, 50_001)).toBe(true);
  });

  it("custo para terminar e resumo da decisão com a janela do plano", () => {
    expect(
      costToFinish({
        remainingRepos: [{ tokens: 8_000 }, { tokens: 7_000 }],
        synthesisTokens: 6_000,
        checkTokens: 2_000,
      }),
    ).toBe(23_000);
    const s = brakeSummary({
      budget: 40_000,
      usedTokens: 52_000,
      estimatedTokens: 45_000,
      toFinish: 23_000,
      planUsage: plan(80),
      pctToTokens: 10_000,
    });
    expect(s).toEqual({
      budget: 40_000,
      used: 52_000,
      estimated: 45_000,
      toFinish: 23_000,
      overBy: 12_000,
      window: { remainingPct: 20, remainingTokens: 200_000, resetsAt: "2026-10-09T18:00:00Z" },
      fitsWindow: true,
    });
    expect(
      brakeSummary({
        budget: 40_000,
        usedTokens: 52_000,
        estimatedTokens: 45_000,
        toFinish: 23_000,
        planUsage: null,
        pctToTokens: null,
      }).window,
    ).toBeNull();
  });
});
