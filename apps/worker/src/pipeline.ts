import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type IngestionRunRecord,
  localeFromLanguage,
  nextStage,
  planStages,
  type Recognizer,
  type Repos,
  type SourceFileRecord,
  type StageJobData,
  type StageName,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { consolidate } from "./processors/consolidate";
import { digest } from "./processors/digest";
import { facts } from "./processors/facts";
import { ocrPagesStage } from "./processors/ocr";
import { readDoc } from "./processors/read-doc";
import { readText } from "./processors/read-text";

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
  const file = deps.repos.sourceFiles.get(run.fileId);
  if (!file) throw new Error(`Arquivo não encontrado: ${run.fileId}`);
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
    deps.repos.ingestionRuns.setStatus(env.run.id, "running");
  }
  const outcome = await PROCESSORS[data.stage](env, ctx, deps);
  const plan = planStages({ isPdf: env.isPdf, options: env.run.options });
  const next = nextStage(plan, data.stage);
  if (next) {
    await deps.enqueue(env.run.id, next);
  } else {
    deps.repos.ingestionRuns.setStatus(env.run.id, "review");
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
    return;
  }
  deps.repos.ingestionRuns.setStatus(data.runId, "error", { error: message });
}
