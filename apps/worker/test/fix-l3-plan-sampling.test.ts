import type { LearnSample } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { withPlanSampling } from "../src/ingest/plan-sampling";

/** Plano de correções F03, item 11 (worker): cada chamada amostra no próprio modelo. */
describe("F03 fix L3 · item 11: síntese e revisor amostram nos próprios modelos", () => {
  it("synthesizeRun (sonnet) e checkProposals (haiku) geram amostras separadas", async () => {
    const base = new MockProvider();
    let utilization = 20;
    const provider = Object.assign(base, {
      planWindowSnapshot: () => ({ utilization: utilization++, resetsAt: "2026-10-10T15:00:00Z" }),
    });
    const samples: LearnSample[] = [];
    const sampled = withPlanSampling(provider, (s) => samples.push(s));
    await sampled.synthesizeRun({ model: "sonnet", reports: [], metricsTable: "" });
    await sampled.checkProposals({ model: "haiku", items: [] });
    expect(samples.map((s) => s.model)).toEqual(["sonnet", "haiku"]);
    expect(samples.every((s) => s.utilizationAfter > s.utilizationBefore && !s.overlapped)).toBe(
      true,
    );
  });

  it("chamadas fora da ingestão passam direto, sem amostra", async () => {
    const samples: LearnSample[] = [];
    const sampled = withPlanSampling(new MockProvider(), (s) => samples.push(s));
    await sampled.detect();
    expect(samples).toEqual([]);
  });
});
