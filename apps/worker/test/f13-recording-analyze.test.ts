import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRecordingChunk,
  createRecording,
  createRepos,
  MediaError,
  type MediaRun,
  migrate,
  openDatabase,
  RECORDING_TASKS,
  type Repos,
  recordingDir,
  seedFixture,
} from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { processTask, type TaskContext } from "../src/tasks";

/**
 * F13/M4 · tarefa recording.analyze: roda as etapas no media (espera se ele está ocupado), acompanha o progresso,
 * importa o resultado e enfileira o relatório do recrutador; falha deixa a entrevista em `failed` com a mensagem.
 */
const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "core",
  "test",
  "fixtures",
  "recording-work",
);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeMedia(
  dataDir: string,
  opts: { busyOnce?: boolean; fail?: string; busyRun?: string } = {},
) {
  let busy = opts.busyOnce ?? false;
  const runs: Array<{ steps: string[] }> = [];
  const polls: Record<string, number> = {};
  let interview = "";
  const media = {
    startRun: async (interviewId: string, steps: string[]) => {
      interview = interviewId;
      if (busy) {
        busy = false;
        throw new MediaError(
          "busy",
          409,
          "Já há uma análise em andamento.",
          opts.busyRun ? { runId: opts.busyRun } : undefined,
        );
      }
      runs.push({ steps });
      cpSync(FIXTURE, join(recordingDir(dataDir, interviewId), "work"), { recursive: true });
      return { id: `run${runs.length}` };
    },
    getRun: async (id: string): Promise<MediaRun> => {
      polls[id] = (polls[id] ?? 0) + 1;
      const done = polls[id] > 1;
      return {
        id,
        interview_id: interview,
        ...(id === opts.busyRun ? { steps: ["probe", "audio", "transcribe", "diarize"] } : {}),
        state: opts.fail ? "failed" : done ? "done" : "running",
        step: done ? null : "transcribe",
        progress: done ? 100 : 40,
        skipped: [],
        error: opts.fail ? { code: "step_failed", message: opts.fail, step: "faces" } : null,
      };
    },
  };
  return { media, runs };
}

function harness(opts: Parameters<typeof fakeMedia>[1] = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const { profileId } = seedFixture(repos, "engineer");
  repos.users.upsert({ fullName: "Alex Souza" });
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-rec-"));
  dirs.push(dataDir);
  const rec = createRecording(
    repos,
    dataDir,
    { profileId, fileName: "call.webm", size: 2 },
    { freeBytes: 1e12 },
  );
  appendRecordingChunk(repos, dataDir, rec.id, 0, new Uint8Array([1, 2]));
  const published: WsEvent[] = [];
  const tasks: Array<{ type: string; queue: string }> = [];
  const { media, runs } = fakeMedia(dataDir, opts);
  const deps: WorkerDeps = {
    repos,
    dataDir,
    provider: new MockProvider(),
    ocr: {
      render: async () => [],
      createRecognizer: async () => ({
        recognize: async () => ({ text: "", confidence: 0 }),
        terminate: async () => {},
      }),
    },
    enqueue: async () => {},
    enqueueTask: async (req) => {
      tasks.push({ type: req.type, queue: req.queue });
    },
    publish: async (e) => {
      published.push(e);
    },
    gh: () => {
      throw new Error("gh não usado");
    },
    media: media as unknown as NonNullable<WorkerDeps["media"]>,
    recordingPollMs: 1,
  };
  const pcts: number[] = [];
  const ctx: TaskContext = {
    jobId: "task__recording.analyze__r",
    progress: async (p) => void pcts.push(p),
  };
  const run = () =>
    processTask(
      {
        kind: "task",
        type: RECORDING_TASKS.analyze,
        key: rec.id,
        payload: { recordingId: rec.id },
      },
      ctx,
      deps,
    );
  return { repos, rec, run, runs, tasks, published, pcts, deps };
}

describe("F13/M4 · recording.analyze", () => {
  it("espera o media ocupado, roda as etapas com imagem, importa e pede o relatório", async () => {
    const h = harness({ busyOnce: true });
    await h.run();
    expect(h.runs.map((r) => r.steps[0])).toEqual(["probe", "probe"]);
    expect(h.runs[1]?.steps).toContain("faces");
    expect(h.runs[1]?.steps).toContain("voice");
    const rec = h.repos.recordings.get(h.rec.id);
    expect(rec).toMatchObject({ state: "analyzing", step: "report" });
    expect(h.repos.recordingAnalysis.persons(h.rec.id)).toHaveLength(2);
    expect(h.tasks).toEqual([{ type: RECORDING_TASKS.report, queue: "extract" }]);
    const ws = h.published.filter((e) => e.type === "recording.updated");
    expect(ws.some((e) => e.type === "recording.updated" && e.step === "transcribe")).toBe(true);
    expect(Math.max(...h.pcts)).toBeGreaterThanOrEqual(90);
  });

  it("falha no media: entrevista em failed com a mensagem da etapa", async () => {
    const h = harness({ fail: "MediaPipe não abriu o vídeo." });
    await h.run();
    expect(h.repos.recordings.get(h.rec.id)).toMatchObject({
      state: "failed",
      error: expect.stringContaining("MediaPipe não abriu o vídeo."),
    });
    expect(h.tasks).toEqual([]);
  });

  it("entrevista apagada no meio do caminho: termina sem erro", async () => {
    const h = harness();
    h.repos.recordings.remove(h.rec.id);
    expect(await h.run()).toMatchObject({ skipped: "not_found" });
  });
});

describe("F13/M5 · recording.report", () => {
  it("lê os quadros, gera o relatório conferido, grava leituras das anotações e fichas; entrevista pronta", async () => {
    const h = harness();
    await h.run();
    const r = await processTask(
      {
        kind: "task",
        type: RECORDING_TASKS.report,
        key: h.rec.id,
        payload: { recordingId: h.rec.id },
      },
      { jobId: "task__recording.report__r", progress: async () => {} },
      h.deps,
    );
    expect(r).toMatchObject({ recordingId: h.rec.id });
    expect(h.repos.recordings.get(h.rec.id)).toMatchObject({
      state: "ready",
      step: null,
      progress: 100,
    });
    const rep = h.repos.recordingAnalysis.latestReport(h.rec.id);
    expect(rep?.version).toBe(1);
    expect(rep?.content.shouldNotHaveSaid.length).toBeGreaterThan(0);
    expect(rep?.content.smile.alert).toMatch(/% do tempo/);
    expect(rep?.content.drills).toHaveLength(3);
    // a leitura de cada quadro fica no relatório: a página mostra o que foi visto ao clicar no quadro
    expect(rep?.content.frameReadings?.length).toBeGreaterThan(0);
    expect(rep?.content.frameReadings?.[0]).toEqual(
      expect.objectContaining({ file: expect.any(String), observed: expect.any(String) }),
    );
    const notes = h.repos.recordingAnalysis.events(h.rec.id).filter((e) => e.type === "note");
    expect(notes.every((e) => e.reason)).toBe(true);
    expect(h.repos.recordingAnalysis.persons(h.rec.id).every((p) => p.card)).toBe(true);
    const usage = h.repos.db.prepare("select category from usage_event").all() as Array<{
      category: string;
    }>;
    expect(usage.map((u) => u.category).sort()).toEqual(["recording.frames", "recording.report"]);
  });

  it("falha do modelo: entrevista em failed com a mensagem, a análise fica", async () => {
    const h = harness();
    await h.run();
    (h.deps.provider as MockProvider).setMode({ errors: { interviewReport: "limite de uso" } });
    await processTask(
      {
        kind: "task",
        type: RECORDING_TASKS.report,
        key: h.rec.id,
        payload: { recordingId: h.rec.id },
      },
      { jobId: "task__recording.report__r", progress: async () => {} },
      h.deps,
    );
    expect(h.repos.recordings.get(h.rec.id)).toMatchObject({ state: "failed" });
    expect(h.repos.recordings.get(h.rec.id)?.error).toMatch(/limite de uso/);
    expect(h.repos.recordingAnalysis.persons(h.rec.id)).toHaveLength(2);
  });
});

describe("F13/M4 · retomada depois de reiniciar o worker", () => {
  it("media ocupado com a execução anterior: acompanha o andamento dela e depois pede o que falta", async () => {
    const h = harness({ busyOnce: true, busyRun: "anterior" });
    await h.run();
    const steps = h.published
      .filter((e) => e.type === "recording.updated")
      .map((e) => (e.type === "recording.updated" ? e.step : null));
    expect(steps).toContain("transcribe");
    expect(steps.indexOf("transcribe")).toBeLessThan(steps.indexOf("import"));
    expect(h.repos.recordings.get(h.rec.id)?.step).toBe("report");
  });
});

describe("F13/M4 · job que falhou de vez", async () => {
  const { onTaskFailed } = await import("../src/tasks");
  it("entrevista em análise vira failed com a mensagem e o convite para tentar de novo", async () => {
    const h = harness();
    h.repos.recordings.update(h.rec.id, { state: "analyzing", step: "transcribe", progress: 30 });
    await onTaskFailed(
      {
        kind: "task",
        type: RECORDING_TASKS.analyze,
        key: h.rec.id,
        payload: { recordingId: h.rec.id },
      },
      new Error("job stalled more than allowable limit"),
      h.deps,
      "media",
    );
    expect(h.repos.recordings.get(h.rec.id)).toMatchObject({ state: "failed", step: null });
    expect(h.repos.recordings.get(h.rec.id)?.error).toMatch(/Tente de novo/);
  });
});

describe("F13/M4 · barra de progresso pelo peso das etapas", async () => {
  const { weightedProgress, mediaSteps } = await import("../src/processors/recording-analyze");
  it("a transcrição pela metade já é perto de um quarto do todo; etapas rápidas quase não andam a barra", () => {
    const steps = mediaSteps(true);
    expect(weightedProgress(steps, "audio", 100)).toBeLessThan(3);
    expect(Math.round(weightedProgress(steps, "transcribe", 50))).toBeGreaterThan(20);
    expect(weightedProgress(steps, "diarize", 0)).toBeGreaterThan(40);
    expect(weightedProgress(steps, "frames", 100)).toBe(100);
    expect(weightedProgress(steps, null, 0)).toBe(0);
  });
});
