import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type GhClient,
  type IngestionRunRecord,
  localeFromLanguage,
  nextStage,
  planStages,
  type Recognizer,
  type Repos,
  type SourceFileRecord,
  type StageJobData,
  type StageName,
  type TaskRequest,
  type TreeEntry,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import type { WsEvent } from "@narnia-jobs/shared";
import { notifyRun, setRunStatus } from "./ingest/status";
import { consolidate } from "./processors/consolidate";
import { digest } from "./processors/digest";
import { facts } from "./processors/facts";
import { ocrPagesStage } from "./processors/ocr";
import { readDoc } from "./processors/read-doc";
import { readText } from "./processors/read-text";
import { reconcileStage } from "./processors/reconcile";
import { reviewCheckStage } from "./processors/review-check";

export interface OcrDeps {
  render: (pdfPath: string, outDir: string) => Promise<string[]>;
  createRecognizer: () => Promise<Recognizer>;
}

export interface WorkerDeps {
  repos: Repos;
  dataDir: string;
  provider: Provider;
  ocr: OcrDeps;
  /** Enfileira a próxima etapa (BullMQ em produção; spy em teste). */
  enqueue: (runId: string, stage: StageName) => Promise<void>;
  /** Enfileira uma tarefa (F03: repositórios, síntese, reconciliação, conferência). */
  enqueueTask: (req: TaskRequest) => Promise<unknown>;
  /** Publica um evento WS (estado da execução e notificações, F03 §2.8). */
  publish: (event: WsEvent) => Promise<void>;
  /** Cliente `gh` com a credencial atual (host/app) ou o falso do mock (F03-1). */
  gh: () => GhClient;
  /** Clone de fallback para árvore truncada (correções F03 item 13); ausente ou `null` = sem fallback. */
  ghCloneTree?: () => ((fullName: string) => Promise<TreeEntry[]>) | null;
}

export interface StageContext {
  runId: string;
  jobId: string;
  progress: (pct: number, note?: string) => Promise<void>;
}

export interface StageOutcome {
  stage: StageName;
  skipped: boolean;
  summary: Record<string, unknown>;
}

export interface StageEnv {
  run: IngestionRunRecord;
  file: SourceFileRecord;
  filePath: string;
  runDir: string;
  isPdf: boolean;
}

export type Processor = (
  env: StageEnv,
  ctx: StageContext,
  deps: WorkerDeps,
) => Promise<Omit<StageOutcome, "stage">>;

const PROCESSORS: Record<StageName, Processor> = {
  "ingest.read_text": readText,
  "ocr.pages": ocrPagesStage,
  "extract.read_doc": readDoc,
  "ingest.consolidate": consolidate,
  "extract.facts": facts,
  "extract.digest": digest,
  "ingest.reconcile": reconcileStage,
  "ingest.review_check": reviewCheckStage,
};

/* ---------- utilitários compartilhados pelos processadores ---------- */

export function readingPath(runId: string, name: string): string {
  return join("readings", runId, `${name}.txt`);
}

export function writeReadingText(dataDir: string, rel: string, text: string): void {
  const abs = join(dataDir, rel);
  mkdirSync(join(dataDir, "readings"), { recursive: true });
  mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
  writeFileSync(abs, text, "utf8");
}

export function readReadingText(dataDir: string, rel: string): string {
  return readFileSync(join(dataDir, rel), "utf8");
}

export function runLocale(repos: Repos, runId: string): string {
  const textLayer = repos.readings.listByRun(runId).find((r) => r.kind === "text_layer");
  const language = (textLayer?.pages as { language?: string } | null)?.language ?? "unknown";
  return localeFromLanguage(language);
}

export function consolidatedText(deps: WorkerDeps, runId: string): string {
  return readReadingText(deps.dataDir, readingPath(runId, "consolidated"));
}

function stageEnv(data: StageJobData, deps: WorkerDeps): StageEnv {
  const run = deps.repos.ingestionRuns.get(data.runId);
  if (!run) throw new Error(`Run não encontrado: ${data.runId}`);
  // a cadeia de etapas é só para CV/texto (F03 §2.9-1); execuções do GitHub não têm arquivo
  const file = run.fileId ? deps.repos.sourceFiles.get(run.fileId) : null;
  if (!file) throw new Error(`Arquivo não encontrado: ${run.fileId ?? "(execução sem arquivo)"}`);
  return {
    run,
    file,
    filePath: join(deps.dataDir, file.path),
    runDir: join(deps.dataDir, "readings", run.id),
    isPdf: file.mime === "application/pdf",
  };
}

/**
 * Executa uma etapa da cadeia (F01 §2.5). Idempotente por etapa: reprocessar (stalled/retry) não duplica leituras,
 * propostas nem chamadas ao modelo. Ao concluir, enfileira a próxima etapa do plano ou marca o run como `review`.
 */
export async function processStage(
  data: StageJobData,
  ctx: StageContext,
  deps: WorkerDeps,
): Promise<StageOutcome> {
  const env = stageEnv(data, deps);
  if (env.run.status === "queued" || env.run.status === "estimating") {
    await setRunStatus(deps, env.run.id, "running");
  }
  const outcome = await PROCESSORS[data.stage](env, ctx, deps);
  const plan = planStages({ isPdf: env.isPdf, options: env.run.options });
  const next = nextStage(plan, data.stage);
  if (next) {
    await deps.enqueue(env.run.id, next);
  } else {
    await setRunStatus(deps, env.run.id, "review");
  }
  await ctx.progress(100);
  return { stage: data.stage, ...outcome };
}

/** Falha definitiva de uma etapa: digest pendente mantém a revisão possível; o resto marca o run como erro. */
export async function onStageFailed(
  data: StageJobData,
  error: Error,
  deps: WorkerDeps,
): Promise<void> {
  const message = error.message || String(error);
  if (data.stage === "extract.digest") {
    deps.repos.ingestionRuns.setStatus(data.runId, "review", {
      error: `Digest pendente: ${message}`,
    });
    await notifyRun(deps, data.runId);
    return;
  }
  await setRunStatus(deps, data.runId, "error", { error: message });
}
