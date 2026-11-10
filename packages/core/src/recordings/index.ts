import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statfsSync } from "node:fs";
import { extname, join } from "node:path";
import {
  RECORDING_CHUNK_BYTES,
  RECORDING_DEFAULT_LIMITS,
  RECORDING_DISK_MARGIN_BYTES,
  RECORDING_EXTENSIONS,
  type Recording,
  type RecordingCreate,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { newId } from "../ids";

/**
 * F13 · entrevista gravada: arquivos e regras do envio (plans/plan-v0/tasks/F13 §2.6 e §6.1.1, R5 e R7).
 *
 * - `<dados>/interviews/<id>/`: `video.part` durante o envio, `video.<ext>` pronto, `work/` do serviço media. Fica
 *   **fora** do backup (F13-2): a lista de pastas do backup não inclui `interviews/`.
 * - `<dados>/interview-frames/<id>/`: quadros escolhidos (M3), dentro do backup.
 */
export const INTERVIEWS_DIR = "interviews";
export const INTERVIEW_FRAMES_DIR = "interview-frames";

export const recordingDir = (dataDir: string, id: string) => join(dataDir, INTERVIEWS_DIR, id);
export const recordingFramesDir = (dataDir: string, id: string) =>
  join(dataDir, INTERVIEW_FRAMES_DIR, id);
const partPath = (dataDir: string, id: string) => join(recordingDir(dataDir, id), "video.part");

export type RecordingErrorCode =
  | "not_found"
  | "invalid"
  | "unsupported_type"
  | "too_large"
  | "insufficient_storage"
  | "offset_mismatch"
  | "not_uploading";

export class RecordingError extends Error {
  readonly code: RecordingErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: RecordingErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RecordingError";
    this.code = code;
    if (details) this.details = details;
  }
}

export interface RecordingLimits {
  maxBytes: number;
  maxSeconds: number;
}

/** Limites do envio (F13-11): `settings.recordings.limits` sobre os padrões. */
export function recordingLimits(repos: Repos): RecordingLimits {
  const saved = repos.settings.get<Partial<RecordingLimits>>("recordings.limits") ?? {};
  const pick = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  return {
    maxBytes: pick(saved.maxBytes, RECORDING_DEFAULT_LIMITS.maxBytes),
    maxSeconds: pick(saved.maxSeconds, RECORDING_DEFAULT_LIMITS.maxSeconds),
  };
}

/** Espaço livre na partição da pasta de dados. */
export function freeDiskBytes(dataDir: string): number {
  mkdirSync(dataDir, { recursive: true });
  const s = statfsSync(dataDir);
  return Number(s.bavail) * Number(s.bsize);
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;

/** Cria a entrevista no início do envio; recusa tipo, tamanho e falta de disco antes do primeiro byte. */
export function createRecording(
  repos: Repos,
  dataDir: string,
  input: RecordingCreate,
  opts: { freeBytes?: number; now?: Date } = {},
): Recording {
  let profileId = input.profileId ?? null;
  let stageId: string | null = null;
  if (input.jobApplicationId) {
    const app = repos.jobApplications.get(input.jobApplicationId);
    if (!app) throw new RecordingError("not_found", "Candidatura não encontrada.");
    profileId = profileId ?? app.profileId ?? null;
    if (input.stageId) {
      if (!app.stages.some((s) => s.id === input.stageId))
        throw new RecordingError("invalid", "Essa etapa não é desta candidatura.");
      stageId = input.stageId;
    }
  } else if (input.stageId) {
    throw new RecordingError("invalid", "Etapa só vale com a candidatura.");
  }
  if (!profileId) throw new RecordingError("invalid", "Escolha o perfil da entrevista.");
  if (!repos.profiles.get(profileId))
    throw new RecordingError("not_found", "Perfil não encontrado.");

  const ext = extname(input.fileName).slice(1).toLowerCase();
  if (!(RECORDING_EXTENSIONS as readonly string[]).includes(ext))
    throw new RecordingError(
      "unsupported_type",
      `Envie um vídeo (${RECORDING_EXTENSIONS.join(", ")}). Teams, Meet e Zoom gravam em mp4 ou webm.`,
    );
  const limits = recordingLimits(repos);
  if (input.size > limits.maxBytes)
    throw new RecordingError(
      "too_large",
      `O vídeo tem ${gb(input.size)}; o limite é ${gb(limits.maxBytes)} (ajustável em Configurações).`,
    );
  const free = opts.freeBytes ?? freeDiskBytes(dataDir);
  if (free < input.size + RECORDING_DISK_MARGIN_BYTES)
    throw new RecordingError(
      "insufficient_storage",
      `Falta espaço em disco: o vídeo precisa de ${gb(input.size + RECORDING_DISK_MARGIN_BYTES)} livres e há ${gb(free)}.`,
    );

  const id = newId();
  mkdirSync(recordingDir(dataDir, id), { recursive: true });
  return repos.recordings.create(
    {
      id,
      profileId,
      jobApplicationId: input.jobApplicationId ?? null,
      stageId,
      title: input.title ?? null,
      fileName: input.fileName,
      mime: input.mime ?? "application/octet-stream",
      ext,
      size: input.size,
    },
    opts.now,
  );
}

const must = (repos: Repos, id: string) => {
  const r = repos.recordings.get(id);
  if (!r) throw new RecordingError("not_found", "Entrevista não encontrada.");
  return r;
};

/**
 * Acrescenta uma parte. Só aceita a parte que começa onde o arquivo parou (`offset === received`): parte repetida
 * (resposta perdida) ou adiantada devolve `offset_mismatch` com `received`, e o navegador retoma dali. Síncrono do
 * conferir ao gravar: duas requisições ao mesmo tempo não intercalam bytes.
 */
export function appendRecordingChunk(
  repos: Repos,
  dataDir: string,
  id: string,
  offset: number,
  bytes: Uint8Array,
  now = new Date(),
): Recording {
  const rec = must(repos, id);
  if (rec.state !== "uploading")
    throw new RecordingError("not_uploading", "O envio desta entrevista já terminou.");
  if (offset !== rec.received)
    throw new RecordingError("offset_mismatch", "Parte fora de ordem.", { received: rec.received });
  if (bytes.byteLength === 0 || bytes.byteLength > RECORDING_CHUNK_BYTES)
    throw new RecordingError("invalid", "Parte vazia ou maior que 8 MB.");
  if (rec.received + bytes.byteLength > rec.size)
    throw new RecordingError("invalid", "A parte passa do tamanho declarado do vídeo.");
  mkdirSync(recordingDir(dataDir, id), { recursive: true });
  appendFileSync(partPath(dataDir, id), bytes);
  const received = rec.received + bytes.byteLength;
  if (received < rec.size) return repos.recordings.update(id, { received }, now);
  const ext = repos.recordings.ext(id) ?? "mp4";
  renameSync(partPath(dataDir, id), join(recordingDir(dataDir, id), `video.${ext}`));
  return repos.recordings.update(id, { received, state: "uploaded", hasVideo: true }, now);
}

/** Caminho do vídeo pronto, ou null (em envio, apagado ou ausente no disco). */
export function recordingVideoPath(dataDir: string, rec: Recording): string | null {
  if (!rec.hasVideo) return null;
  const ext = extname(rec.fileName).slice(1).toLowerCase();
  const path = join(recordingDir(dataDir, rec.id), `video.${ext}`);
  return existsSync(path) ? path : null;
}

/** Apaga só o vídeo (F13-2): a análise fica; sem reprodução e sem refazer a parte visual. */
export function removeRecordingVideo(
  repos: Repos,
  dataDir: string,
  id: string,
  now = new Date(),
): Recording {
  const rec = must(repos, id);
  const ext = repos.recordings.ext(id) ?? "";
  rmSync(join(recordingDir(dataDir, id), `video.${ext}`), { force: true });
  rmSync(partPath(dataDir, id), { force: true });
  return repos.recordings.update(
    id,
    rec.state === "uploading"
      ? { hasVideo: false, state: "failed", error: "Envio cancelado." }
      : { hasVideo: false },
    now,
  );
}

const removeFiles = (dataDir: string, id: string) => {
  rmSync(recordingDir(dataDir, id), { recursive: true, force: true });
  rmSync(recordingFramesDir(dataDir, id), { recursive: true, force: true });
};

/** Apaga a entrevista inteira: banco, vídeo, trabalho do media e quadros. */
export function removeRecording(repos: Repos, dataDir: string, id: string): void {
  must(repos, id);
  repos.recordings.remove(id);
  removeFiles(dataDir, id);
}

/** Pastas das entrevistas de uma candidatura (quem apaga a candidatura chama antes de apagar a linha). */
export function removeApplicationRecordingFiles(
  repos: Repos,
  dataDir: string,
  applicationId: string,
): void {
  for (const r of repos.recordings.listByApplication(applicationId)) removeFiles(dataDir, r.id);
}
