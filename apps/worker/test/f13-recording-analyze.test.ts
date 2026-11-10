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

function fakeMedia(dataDir: string, opts: { busyOnce?: boolean; fail?: string } = {}) {
  let busy = opts.busyOnce ?? false;
  const runs: Array<{ steps: string[] }> = [];
  const polls: Record<string, number> = {};
  const media = {
    startRun: async (interviewId: string, steps: string[]) => {
      if (busy) {
        busy = false;
        throw new MediaError("busy", 409, "Já há uma análise em andamento.");
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
        interview_id: "x",
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
  return { repos, rec, run, runs, tasks, published, pcts };
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
