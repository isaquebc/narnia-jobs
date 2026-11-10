import { z } from "zod";

/**
 * F13 · análise de entrevista gravada. Serviço `media` (Python, perfil Docker opcional): estado visto pelo api, para a
 * tela de Configurações e para recusar envios quando ele não está pronto (plans/plan-v0/tasks/F13 §6.1.1, R2 e R4).
 *
 * - `off`: sem `NARNIA_MEDIA_URL` ou o serviço não responde (perfil desligado); a tela mostra como ligar.
 * - `needs_token`: no ar, sem token do Hugging Face (a separação de vozes precisa dele, F13-5).
 * - `ready`: no ar e com token.
 * O token nunca aparece aqui: só se está configurado.
 */
export const MediaStateSchema = z.enum(["off", "needs_token", "ready"]);
export type MediaState = z.infer<typeof MediaStateSchema>;

export const MediaStatusSchema = z.object({
  state: MediaStateSchema,
  /** Comando que liga o serviço (no computador, fora do app). */
  enableCommand: z.string(),
  version: z.string().nullable(),
  busy: z.boolean(),
  steps: z.array(z.string()),
});
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const MediaTokenRequestSchema = z.object({ token: z.string().min(1).max(300) });
export type MediaTokenRequest = z.infer<typeof MediaTokenRequestSchema>;

/**
 * Entrevista gravada (F13 §3; no M1 só a tabela principal). Nasce no início do envio (`uploading`), com o tamanho
 * esperado; as partes chegam em ordem (`received`) e a última renomeia o arquivo (`uploaded`). A análise (M4) leva a
 * `analyzing` → `ready` ou `failed`. Sem vídeo (`hasVideo` falso) a análise continua, sem reprodução.
 */
export const RecordingStateSchema = z.enum([
  "uploading",
  "uploaded",
  "analyzing",
  "ready",
  "failed",
]);
export type RecordingState = z.infer<typeof RecordingStateSchema>;

/** Extensões aceitas (vídeo; áudio puro fica para depois do M3, F13 §1). */
export const RECORDING_EXTENSIONS = ["mp4", "webm", "mkv", "mov", "m4v"] as const;
/** Tamanho de cada parte do envio: cabe no limite de corpo do nginx (12 MB). */
export const RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;
/** Limites iniciais (F13-11, a medir): ajustáveis em `settings.recordings.limits`. */
export const RECORDING_DEFAULT_LIMITS = { maxBytes: 4 * 1024 ** 3, maxSeconds: 3 * 3600 } as const;
/** Folga de disco exigida além do tamanho do vídeo (áudio extraído, quadros e trabalho do media). */
export const RECORDING_DISK_MARGIN_BYTES = 2 * 1024 ** 3;

/** Configurações › Análise de vídeo: limites do envio (F13-11). */
export const RecordingLimitsSchema = z.object({
  maxBytes: z.number().int().positive(),
  maxSeconds: z.number().int().positive(),
});
export type RecordingLimits = z.infer<typeof RecordingLimitsSchema>;

export const RecordingSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  jobApplicationId: z.string().nullable(),
  stageId: z.string().nullable(),
  title: z.string().nullable(),
  state: RecordingStateSchema,
  fileName: z.string(),
  mime: z.string(),
  size: z.number().int(),
  received: z.number().int(),
  hasVideo: z.boolean(),
  durationS: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Recording = z.infer<typeof RecordingSchema>;

export const RecordingCreateSchema = z.object({
  /** Obrigatório no envio avulso; na candidatura vem dela quando omitido. */
  profileId: z.string().min(1).optional(),
  jobApplicationId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().max(100).default("application/octet-stream"),
});
export type RecordingCreate = z.input<typeof RecordingCreateSchema>;
