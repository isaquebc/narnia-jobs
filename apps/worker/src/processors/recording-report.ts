import { existsSync } from "node:fs";
import {
  buildInterviewBrief,
  checkInterviewReport,
  type FrameReading,
  formatTranscript,
  mmss,
  RECORDING_MODEL_DEFAULTS,
  type RecordingModelKey,
  type RecordingPatch,
  recordingAnalysis,
  recordingFramesDir,
  recordUsage,
  resolveModel,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type { TaskHandler } from "../tasks";

/**
 * F13/M5 · relatório do recrutador sobre a entrevista gravada (plans/plan-v0/tasks/F13 §2.5). Dois elos: o modelo
 * barato descreve os quadros escolhidos (tool Read) e o Sonnet escreve o relatório com a transcrição numerada, as
 * medições, a vaga, o CV enviado e as entrevistas anteriores do processo; o código confere citações e tempos, guarda
 * uma versão nova, a leitura de cada anotação e a ficha de cada pessoa. Falha nos quadros não impede o relatório.
 */
export const recordingReport: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const id = String(data.payload.recordingId ?? "");
  if (!repos.recordings.get(id)) return { skipped: "not_found" };
  const model = (k: RecordingModelKey) =>
    resolveModel(repos.settings, k, RECORDING_MODEL_DEFAULTS[k]);
  const set = async (patch: RecordingPatch) => {
    if (!repos.recordings.get(id)) return;
    const r = repos.recordings.update(id, patch);
    await deps.publish({
      type: "recording.updated",
      recordingId: id,
      state: r.state,
      step: r.step,
      progress: r.progress,
    });
  };
  try {
    await set({ state: "analyzing", step: "report", progress: 94, error: null });
    const a = recordingAnalysis(repos, id);
    const keyOf = new Map(a.persons.map((p) => [p.id, p.key]));
    let frames: FrameReading[] = [];
    const dir = recordingFramesDir(deps.dataDir, id);
    if (a.frames.length && existsSync(dir)) {
      const m = model("interview_frames");
      try {
        const kinds = new Map(
          a.events.map((e) => [e.key, e.level ? `${e.type} (${e.level})` : e.type]),
        );
        const r = await deps.provider.interviewFrames({
          dir,
          model: m,
          frames: a.frames.map((f) => ({
            file: f.file,
            at: mmss(f.t),
            person: f.personId ? (keyOf.get(f.personId) ?? "?") : "?",
            reason:
              f.reason === "reference"
                ? "referência"
                : f.events.map((e) => kinds.get(e) ?? e).join(", "),
          })),
        });
        recordUsage(
          repos,
          deps.dataDir,
          usageFromSdkResult(r.sdk, { category: "recording.frames", model: m, jobId: ctx.jobId }),
        );
        frames = r.output.frames;
      } catch {
        // sem a leitura dos quadros o relatório sai, e a limitação aparece nele
      }
    }
    await ctx.progress(50, "report");
    const m = model("interview_report");
    const r = await deps.provider.interviewReport({
      brief: buildInterviewBrief(repos, id, frames),
      transcript: formatTranscript(a),
      model: m,
    });
    const usage = recordUsage(
      repos,
      deps.dataDir,
      usageFromSdkResult(r.sdk, { category: "recording.report", model: m, jobId: ctx.jobId }),
    );
    const fresh = recordingAnalysis(repos, id);
    const { content, warnings } = checkInterviewReport(
      r.output,
      fresh,
      repos.recordingAnalysis.turnWords(id),
    );
    repos.recordingAnalysis.addReport(id, { content, warnings, model: m, usageEventId: usage.id });
    for (const n of content.notes)
      repos.recordingAnalysis.updateEvent(id, n.event, { reading: n.reading, reason: n.reason });
    const byKey = new Map(fresh.persons.map((p) => [p.key, p.id]));
    for (const p of content.people) {
      const pid = byKey.get(p.person);
      if (pid)
        repos.recordingAnalysis.updatePerson(pid, {
          card: { role: p.role, summary: p.summary, signals: p.signals },
        });
    }
    await set({ state: "ready", step: null, progress: 100 });
    await ctx.progress(100);
    return { recordingId: id, warnings: warnings.length };
  } catch (e) {
    if (!repos.recordings.get(id)) return { skipped: "not_found" };
    const message = e instanceof Error ? e.message : String(e);
    await set({ state: "failed", step: null, error: `O relatório não saiu: ${message}` });
    return { failed: message };
  }
};
