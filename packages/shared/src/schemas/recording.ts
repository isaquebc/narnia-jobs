import { z } from "zod";

/**
 * F13 · análise de entrevista gravada. Serviço `media` (Python, perfil Docker opcional): estado visto pelo api, para a
 * tela de Configurações e para recusar envios quando ele não está pronto (plans/plan-v0/tasks/done/F13 §6.1.1, R2 e R4).
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
  /** Análise (M4): etapa atual e porcentagem do todo; `approximate` = vozes separadas pela boca (sem token). */
  step: z.string().nullable(),
  progress: z.number().int(),
  language: z.string().nullable(),
  meetingStartS: z.number().nullable(),
  approximate: z.boolean(),
  analyzedAt: z.string().nullable(),
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

// ── F13/M4 · análise ────────────────────────────────────────────────────────────────────────────────────────────────

/** Etapas do serviço media, na ordem (§2.2). Com imagem, voz e áudio rodam depois da ligação voz–rosto (por pessoa). */
export const MEDIA_BASE_STEPS = ["probe", "audio", "transcribe", "diarize", "turns"] as const;
export const MEDIA_VIDEO_STEPS = [
  "faces",
  "layout",
  "link",
  "voice",
  "levels",
  "events",
  "frames",
] as const;
export const MEDIA_AUDIO_ONLY_STEPS = ["voice", "levels"] as const;
/** Todas as etapas visíveis na tela, na ordem: as do media, importar e a cadeia do recrutador (M5). */
export const RECORDING_STEPS = [
  ...MEDIA_BASE_STEPS,
  ...MEDIA_VIDEO_STEPS,
  "import",
  "report",
] as const;
export type RecordingStep = (typeof RECORDING_STEPS)[number];

export const ReliabilitySchema = z.object({
  detectedPct: z.number(),
  facePx: z.number(),
  level: z.enum(["good", "weak", "poor"]),
});
export type Reliability = z.infer<typeof ReliabilitySchema>;

export const RecordingPersonSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string().nullable(),
  nameSource: z.enum(["ocr", "user"]).nullable(),
  isCandidate: z.boolean(),
  candidateSource: z.enum(["name", "talk", "user"]).nullable(),
  contactId: z.string().nullable(),
  speaker: z.string().nullable(),
  track: z.string().nullable(),
  ambiguous: z.boolean(),
  /** Voz, áudio, rosto e câmera, com a confiabilidade (F13-4). */
  measurements: z.record(z.string(), z.unknown()),
  card: z.record(z.string(), z.unknown()).nullable(),
});
export type RecordingPerson = z.infer<typeof RecordingPersonSchema>;

export const RecordingTurnSchema = z.object({
  id: z.string(),
  idx: z.number().int(),
  personId: z.string().nullable(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  corrected: z.boolean(),
});
export type RecordingTurn = z.infer<typeof RecordingTurnSchema>;

export const NoteReadingSchema = z.enum(["favorable", "unfavorable", "indeterminate"]);
export const RecordingEventSchema = z.object({
  id: z.string(),
  key: z.string(),
  personId: z.string().nullable(),
  t: z.number(),
  durationS: z.number().nullable(),
  type: z.enum(["note", "smile", "brow_raise", "frown"]),
  level: z.enum(["confirmed", "probable"]).nullable(),
  reading: NoteReadingSchema.nullable(),
  reason: z.string().nullable(),
  turnIdx: z.number().int().nullable(),
  frame: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type RecordingEvent = z.infer<typeof RecordingEventSchema>;

export const RecordingFrameSchema = z.object({
  t: z.number(),
  file: z.string(),
  reason: z.enum(["event", "reference"]),
  personId: z.string().nullable(),
  events: z.array(z.string()),
});
export type RecordingFrame = z.infer<typeof RecordingFrameSchema>;

// ── F13/M5 · cadeia do recrutador ───────────────────────────────────────────────────────────────────────────────────

/** Leitura dos quadros (Haiku com a tool Read): só o que se vê, e a hipótese separada. Nunca identifica pessoas. */
export const InterviewFramesOutputSchema = z.object({
  frames: z.array(
    z.object({
      file: z.string(),
      observed: z.string(),
      hypothesis: z.string(),
    }),
  ),
});
export type InterviewFramesOutput = z.infer<typeof InterviewFramesOutputSchema>;

const Certainty = z.enum(["high", "medium", "low"]);
/** Trecho literal de um turno do candidato (o código confere e acha o segundo exato pelas palavras). */
const Quote = { turn: z.number().int(), quote: z.string() };
const ModelScore = z.object({
  points: z.number().int().min(0).max(10),
  reason: z.string(),
  turns: z.array(z.number().int()),
});

/**
 * Rascunho do relatório pelo modelo (§2.5, ordem aprovada pelo dono, F13-14). Tempos no texto livre vão como `[mm:ss]`
 * (a página vira link para o vídeo; o código confere que existem). Reescritas ficam em campos separados das citações.
 */
export const InterviewReportDraftSchema = z.object({
  verdict: z.object({
    level: z.enum(["strong", "mixed", "weak"]),
    summary: z.string(),
    points: z.array(z.string()),
  }),
  shouldNotHaveSaid: z.array(
    z.object({ ...Quote, observed: z.string(), interpretation: z.string(), better: z.string() }),
  ),
  answers: z.array(
    z.object({
      questionTurn: z.number().int(),
      question: z.string(),
      answerTurns: z.array(z.number().int()),
      problem: z.enum(["wrong", "incomplete", "tangent", "unclear"]),
      missing: z.string(),
      suggestion: z.string(),
      certainty: Certainty,
    }),
  ),
  worked: z.array(z.object({ ...Quote, why: z.string() })),
  discourse: z.object({ summary: z.string(), points: z.array(z.string()) }),
  smile: z.object({ observations: z.array(z.string()) }),
  reactions: z.array(
    z.object({
      event: z.string().nullable(),
      person: z.string(),
      observed: z.string(),
      hypothesis: z.string(),
    }),
  ),
  notes: z.array(z.object({ event: z.string(), reading: NoteReadingSchema, reason: z.string() })),
  setup: z.object({
    people: z.array(
      z.object({ person: z.string(), camera: z.string(), lighting: z.string(), audio: z.string() }),
    ),
    tips: z.array(z.string()),
  }),
  people: z.array(
    z.object({
      person: z.string(),
      role: z.string(),
      summary: z.string(),
      signals: z.array(z.string()),
    }),
  ),
  drills: z.array(z.object({ title: z.string(), how: z.string() })),
  limitations: z.array(z.string()),
  /** Pontos de 0 a 10 dos critérios de conteúdo, com os turnos que justificam (o setup é medido pelo código). */
  scores: z.object({
    completeness: ModelScore,
    objectivity: ModelScore,
    clarity: ModelScore,
  }),
});
export type InterviewReportDraft = z.infer<typeof InterviewReportDraftSchema>;

/** Pesos da nota da entrevista (decisão do dono, 2026-11-10): o setup é a média de câmera, áudio e ruído medidos. */
export const INTERVIEW_SCORE_WEIGHTS = {
  completeness: 40,
  objectivity: 20,
  clarity: 20,
  setup: 20,
} as const;
export const InterviewScoreKeySchema = z.enum(["completeness", "objectivity", "clarity", "setup"]);
export type InterviewScoreKey = z.infer<typeof InterviewScoreKeySchema>;
export const InterviewSetupKeySchema = z.enum(["camera", "audio", "noise"]);
export type InterviewSetupKey = z.infer<typeof InterviewSetupKeySchema>;

/** Nota montada pelo código: `points` nulo = não medido (fica fora da média, com os pesos redistribuídos). */
export const InterviewScoreSchema = z.object({
  overall: z.number().int().min(0).max(100).nullable(),
  criteria: z.array(
    z.object({
      key: InterviewScoreKeySchema,
      points: z.number().min(0).max(10).nullable(),
      weight: z.number(),
      reason: z.string(),
      turns: z.array(z.number().int()),
    }),
  ),
  setup: z.array(
    z.object({
      key: InterviewSetupKeySchema,
      points: z.number().min(0).max(10).nullable(),
      reason: z.string(),
    }),
  ),
});
export type InterviewScore = z.infer<typeof InterviewScoreSchema>;

/** Relatório guardado: o rascunho conferido por código, com o segundo de cada citação e o alerta do sorriso (F13-4). */
export const RecordingReportContentSchema = InterviewReportDraftSchema.extend({
  shouldNotHaveSaid: z.array(
    z.object({
      ...Quote,
      t: z.number(),
      observed: z.string(),
      interpretation: z.string(),
      better: z.string(),
    }),
  ),
  answers: z.array(
    z.object({
      questionTurn: z.number().int(),
      question: z.string(),
      answerTurns: z.array(z.number().int()),
      t: z.number(),
      problem: z.enum(["wrong", "incomplete", "tangent", "unclear"]),
      missing: z.string(),
      suggestion: z.string(),
      certainty: Certainty,
    }),
  ),
  worked: z.array(z.object({ ...Quote, t: z.number(), why: z.string() })),
  smile: z.object({
    observations: z.array(z.string()),
    /** Montado pelo código com a % de detecção e o tamanho do rosto; nunca omitido quando a detecção é fraca. */
    alert: z.string().nullable(),
    reliability: ReliabilitySchema.nullable(),
  }),
  reactions: z.array(
    z.object({
      event: z.string().nullable(),
      person: z.string(),
      t: z.number().nullable(),
      observed: z.string(),
      hypothesis: z.string(),
    }),
  ),
  notes: z.array(
    z.object({ event: z.string(), t: z.number(), reading: NoteReadingSchema, reason: z.string() }),
  ),
  // relatórios gravados antes da nota não têm estes campos
  scores: InterviewReportDraftSchema.shape.scores.optional(),
  /** Leitura de cada quadro (o que se vê e a hipótese), para os detalhes do quadro na página. */
  frameReadings: InterviewFramesOutputSchema.shape.frames.optional(),
  score: InterviewScoreSchema.optional(),
});
export type RecordingReportContent = z.infer<typeof RecordingReportContentSchema>;

export const RecordingReportSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  content: RecordingReportContentSchema,
  warnings: z.array(z.string()),
  model: z.string().nullable(),
  createdAt: z.string(),
});
export type RecordingReport = z.infer<typeof RecordingReportSchema>;

export const RecordingAnalysisSchema = z.object({
  recording: RecordingSchema,
  persons: z.array(RecordingPersonSchema),
  turns: z.array(RecordingTurnSchema),
  events: z.array(RecordingEventSchema),
  frames: z.array(RecordingFrameSchema),
  measurements: z.record(z.string(), z.unknown()).nullable(),
  report: RecordingReportSchema.nullable(),
});
export type RecordingAnalysis = z.infer<typeof RecordingAnalysisSchema>;

export const RecordingPersonPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isCandidate: z.boolean().optional(),
  contactId: z.string().min(1).nullable().optional(),
});
export type RecordingPersonPatch = z.infer<typeof RecordingPersonPatchSchema>;

export const RecordingTurnPatchSchema = z.object({ personId: z.string().min(1) });
export type RecordingTurnPatch = z.infer<typeof RecordingTurnPatchSchema>;
