import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  importMediaResults,
  MediaClient,
  MediaError,
  RECORDING_TASKS,
  type RecordingPatch,
  recordingDir,
  recordingLimits,
  recordingVideoPath,
} from "@narnia-jobs/core";
import {
  MEDIA_AUDIO_ONLY_STEPS,
  MEDIA_BASE_STEPS,
  MEDIA_VIDEO_STEPS,
  RECORDING_STEPS,
  type Recording,
} from "@narnia-jobs/shared";
import type { TaskHandler } from "../tasks";

/**
 * F13/M4 · análise da entrevista gravada (fila `media`, uma por vez; plans/plan-v0/tasks/F13 §2.1). O worker orquestra:
 * pede as etapas ao serviço media (que grava um JSON por etapa e pula o que já fez, então tentar de novo retoma),
 * acompanha o progresso, importa o resultado para o banco e enfileira o relatório do recrutador (`recording.report`).
 * Se o media está ocupado com outra execução (o worker reiniciou no meio de uma), espera ela terminar.
 */
const MEDIA_SHARE = 90; // % do todo que o media ocupa na barra; importar e o relatório ficam com o resto
const BUSY_WAIT_MS = 5_000;
const MAX_NETWORK_ERRORS = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Peso de cada etapa na barra, pelo tempo medido no teste de viabilidade (54 min em CPU: transcrição ~21 min, vozes
 * ~16 min, rostos ~2 min); as outras são segundos.
 */
const STEP_WEIGHT: Record<string, number> = {
  transcribe: 45,
  diarize: 35,
  faces: 8,
  layout: 2,
  voice: 3,
};

/** Porcentagem da execução do media pelo peso das etapas: as já feitas + a fração da atual. */
export function weightedProgress(
  steps: string[],
  step: string | null,
  stepProgress: number,
): number {
  const w = (s: string) => STEP_WEIGHT[s] ?? 1;
  const total = steps.reduce((a, s) => a + w(s), 0) || 1;
  const i = step ? steps.indexOf(step) : -1;
  if (i < 0) return 0;
  const done = steps.slice(0, i).reduce((a, s) => a + w(s), 0);
  return Math.min(100, (100 * (done + (w(step as string) * stepProgress) / 100)) / total);
}

/** Etapas com imagem quando o vídeo tem trilha de vídeo; só áudio, sem as visuais. */
export function mediaSteps(hasVideoStream: boolean): string[] {
  return [...MEDIA_BASE_STEPS, ...(hasVideoStream ? MEDIA_VIDEO_STEPS : MEDIA_AUDIO_ONLY_STEPS)];
}

function readProbe(dataDir: string, id: string): { duration?: number; video?: unknown } | null {
  const p = join(recordingDir(dataDir, id), "work", "probe.json");
  return existsSync(p)
    ? (JSON.parse(readFileSync(p, "utf8")) as { duration?: number; video?: unknown })
    : null;
}

export const recordingAnalyze: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const id = String(data.payload.recordingId ?? "");
  if (!repos.recordings.get(id)) return { skipped: "not_found" };
  const media = deps.media ?? MediaClient.fromEnv();
  const pollMs = deps.recordingPollMs ?? 2_000;
  const set = async (patch: RecordingPatch): Promise<Recording | null> => {
    if (!repos.recordings.get(id)) return null;
    const r = repos.recordings.update(id, patch);
    await deps.publish({
      type: "recording.updated",
      recordingId: id,
      state: r.state,
      step: r.step,
      progress: r.progress,
    });
    return r;
  };

  /** Roda as etapas e devolve quando terminam; `span` = [início, fim] da barra para essa execução. */
  const runMedia = async (steps: string[], span: [number, number]) => {
    let run: { id: string } | null = null;
    while (!run) {
      try {
        run = await media.startRun(id, steps);
      } catch (e) {
        if (e instanceof MediaError && e.code === "busy") {
          // o worker reiniciou no meio: a execução anterior desta entrevista segue no media; acompanha ela (a barra
          // anda) e depois pede de novo, e o media pula o que já fez
          const other = typeof e.details?.runId === "string" ? e.details.runId : null;
          if (other && (await follow(other, steps, span, true))) continue;
          await sleep(pollMs >= 1000 ? BUSY_WAIT_MS : pollMs);
          continue;
        }
        throw e;
      }
    }
    await follow(run.id, steps, span, false);
  };

  /** Acompanha uma execução até o fim; `foreign`: só se for desta entrevista (devolve false se não for). */
  const follow = async (
    runId: string,
    steps: string[],
    span: [number, number],
    foreign: boolean,
  ): Promise<boolean> => {
    let errors = 0;
    let last = "";
    for (;;) {
      await sleep(pollMs);
      if (!repos.recordings.get(id)) throw new Error("apagada");
      let state: Awaited<ReturnType<MediaClient["getRun"]>>;
      try {
        state = await media.getRun(runId, { brief: true });
        errors = 0;
        if (foreign && state.interview_id !== id) return false;
      } catch (e) {
        if (e instanceof MediaError && e.code === "media_off" && ++errors < MAX_NETWORK_ERRORS)
          continue;
        throw e;
      }
      if (state.state === "failed") {
        if (foreign) return true; // a anterior falhou: a nova tentativa mostra o erro dela
        throw new Error(state.error?.message ?? "O serviço de análise de vídeo falhou.");
      }
      // execução anterior: a barra segue as etapas dela, no trecho do media inteiro
      const own = foreign && state.steps?.length ? state.steps : steps;
      if (foreign) span = [1, MEDIA_SHARE];
      const frac =
        state.state === "done" ? 100 : weightedProgress(own, state.step, state.step_progress ?? 0);
      const pct = Math.round(span[0] + ((span[1] - span[0]) * frac) / 100);
      const key = `${state.step}:${pct}`;
      if (key !== last) {
        last = key;
        await set({ step: state.step ?? steps[steps.length - 1] ?? null, progress: pct });
        await ctx.progress(pct, state.step ?? undefined);
      }
      if (state.state === "done") return true;
    }
  };

  try {
    const rec = repos.recordings.get(id);
    if (!rec || !recordingVideoPath(deps.dataDir, rec))
      throw new Error("O vídeo não está mais na pasta: envie de novo para analisar.");
    await set({ state: "analyzing", step: RECORDING_STEPS[0], progress: 0, error: null });
    await runMedia(["probe"], [0, 1]);
    const probe = readProbe(deps.dataDir, id);
    const limit = recordingLimits(repos).maxSeconds;
    if (probe?.duration && probe.duration > limit)
      throw new Error(
        `O vídeo tem ${Math.round(probe.duration / 60)} min; o limite é ${Math.round(limit / 60)} min (ajustável em Configurações).`,
      );
    await runMedia(mediaSteps(Boolean(probe?.video)), [1, MEDIA_SHARE]);
    await set({ step: "import", progress: MEDIA_SHARE + 2 });
    importMediaResults(repos, deps.dataDir, id);
    await set({ step: "report", progress: MEDIA_SHARE + 4 });
    await deps.enqueueTask({
      queue: "extract",
      type: RECORDING_TASKS.report,
      key: `${id}-${Date.now()}`,
      payload: { recordingId: id },
    });
    await ctx.progress(100);
    return { recordingId: id };
  } catch (e) {
    if (!repos.recordings.get(id)) return { skipped: "not_found" };
    const message = e instanceof Error ? e.message : String(e);
    await set({ state: "failed", step: null, error: message });
    return { failed: message };
  }
};
