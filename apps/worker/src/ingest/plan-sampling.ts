import { createPlanSampler, type LearnSample } from "@narnia-jobs/core";
import type { Provider, Usage } from "@narnia-jobs/providers";

/** Chamadas da ingestão que consomem a janela do plano e entram no aprendizado %→tokens (correções F03, item 11). */
const SAMPLED = new Set(["pickFiles", "analyzeRepo", "synthesizeRun", "checkProposals"]);

const tokensOf = (r: { usage?: Usage }): number =>
  r.usage
    ? r.usage.inputTokens +
      r.usage.outputTokens +
      r.usage.cacheReadTokens +
      r.usage.cacheWriteTokens
    : 0;

/**
 * Envolve o provider: cada chamada da ingestão lê a janela do plano imediatamente antes e depois (evento estável
 * do stream, `planWindowSnapshot`) e grava uma amostra no modelo daquela chamada. Um único amostrador por processo
 * do worker, para marcar como concorrentes as chamadas que se sobrepõem (concorrência 2 da ingestão).
 */
export function withPlanSampling(provider: Provider, record: (s: LearnSample) => void): Provider {
  const sampler = createPlanSampler({ snapshot: () => provider.planWindowSnapshot(), record });
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || !SAMPLED.has(prop) || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (input: { model: string }) =>
        sampler.track(input.model, () => value.call(target, input), tokensOf);
    },
  });
}
