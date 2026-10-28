import {
  analyzePostingText,
  applyPostingMerge,
  duplicateCandidate,
  duplicateSide,
  POSTING_MODEL_DEFAULTS,
  type PostingModelKey,
  recordDuplicateCheck,
  recordUsage,
  resolveModel,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { PreAnalysis } from "@narnia-jobs/shared";
import type { TaskHandler } from "../tasks";

/**
 * Extração da vaga (F06 §2.1, M4): modelo barato extrai (F06-5), outro agente junta com a heurística (F06-6), e uma
 * vaga salva com o mesmo hash dispara a comparação de duplicata (F06-9). Falha deixa a vaga em `error` com o que a
 * heurística já gravou.
 */
export const postingExtract: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const id = String(data.payload.postingId ?? "");
  const posting = repos.postings.get(id);
  if (!posting) return { skipped: "posting_not_found" };
  const model = (key: PostingModelKey) =>
    resolveModel(repos.settings, key, POSTING_MODEL_DEFAULTS[key]);
  const usage = (category: string, m: string, sdk: Parameters<typeof usageFromSdkResult>[0]) =>
    recordUsage(
      repos,
      deps.dataDir,
      usageFromSdkResult(sdk, { category, model: m, jobId: ctx.jobId }),
    );
  const text = posting.jdText;
  try {
    if (!text) {
      repos.postings.setStatus(id, "ready");
      return { skipped: "no_text" };
    }
    await ctx.progress(15, "extracting");
    const extractModel = model("posting_extract");
    const extracted = await deps.provider.postingExtract({ text, model: extractModel });
    usage("posting.extract", extractModel, extracted.sdk);

    await ctx.progress(50, "merging");
    const pre = posting.preAnalysis as PreAnalysis | null;
    const mergeModel = model("posting_merge");
    const merged = await deps.provider.postingMerge({
      text,
      model: mergeModel,
      extracted: extracted.output,
      heuristic: {
        // as etapas do processo (F07/M2) não passam pelo modelo: a heurística já as gravou na vaga
        fields: (({ hiringSteps: _steps, ...f }) => f)(analyzePostingText(text).fields),
        keywords: (pre?.keywords ?? []).map((k) => ({ term: k.term, section: k.section })),
      },
    });
    usage("posting.merge", mergeModel, merged.sdk);
    const updated = applyPostingMerge(repos, id, merged.output);

    await ctx.progress(80, "dedupe");
    const candidate = duplicateCandidate(repos, id);
    let duplicate: { candidateId: string; confidence: number } | null = null;
    if (candidate) {
      const dupModel = model("posting_duplicate");
      const d = await deps.provider.postingDuplicate({
        saved: duplicateSide(candidate),
        incoming: duplicateSide(updated),
        model: dupModel,
      });
      usage("posting.duplicate", dupModel, d.sdk);
      const check = recordDuplicateCheck(repos, id, candidate.id, d.output);
      duplicate = { candidateId: check.candidateId, confidence: check.confidence };
    }
    repos.postings.setStatus(id, "ready");
    await deps.publish({ type: "posting.updated", postingId: id });
    return { postingId: id, duplicate };
  } catch (e) {
    repos.postings.setStatus(id, "error");
    await deps.publish({ type: "posting.updated", postingId: id });
    throw e;
  }
};
