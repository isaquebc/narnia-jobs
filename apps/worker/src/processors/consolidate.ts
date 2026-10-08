import { charsToTokens, consolidateReadings, type ReadingKind } from "@narnia-jobs/core";
import { type Processor, readingPath, readReadingText, writeReadingText } from "../pipeline";

/** Etapa 4: alinha as leituras por seção, vota divergências e grava o texto canônico + segmentos com origem (F01-22). */
export const consolidate: Processor = async (env, ctx, deps) => {
  const readings = deps.repos.readings.listByRun(env.run.id);
  if (readings.length === 0) throw new Error("Nenhuma leitura disponível para consolidar");
  await ctx.progress(20);
  const inputs = readings.map((r) => ({
    kind: r.kind as ReadingKind,
    text: readReadingText(deps.dataDir, r.textPath),
    quality: r.quality,
  }));
  let result = consolidateReadings(inputs);
  if (!result.text.trim()) {
    // todas as leituras ficaram abaixo do limiar: usa a mais longa para não travar a cadeia
    const longest = [...inputs].sort((a, b) => b.text.length - a.text.length)[0];
    if (!longest || longest.text.trim().length < 20) {
      throw new Error("Nenhuma leitura utilizável: o arquivo parece vazio ou ilegível");
    }
    result = consolidateReadings([{ ...longest, quality: 1 }]);
  }
  writeReadingText(deps.dataDir, readingPath(env.run.id, "consolidated"), result.text);
  deps.repos.readings.replaceSegments(env.run.id, result.segments);
  const textTokens = charsToTokens(result.text.length);
  const current = env.run.estimate;
  if (current) {
    deps.repos.ingestionRuns.setEstimate(env.run.id, {
      ...current,
      factsTokens: Math.max(current.factsTokens, textTokens),
    });
  }
  return {
    skipped: false,
    summary: {
      chars: result.text.length,
      segments: result.segments.length,
      usedKinds: result.usedKinds,
    },
  };
};
