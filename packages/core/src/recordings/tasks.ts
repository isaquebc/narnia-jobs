/** F13 · tarefas da entrevista gravada: análise no serviço media (fila `media`, uma por vez) e relatório do recrutador
 * (fila `extract`, modelo). */
export const RECORDING_TASKS = {
  analyze: "recording.analyze",
  report: "recording.report",
} as const;

/** Modelos padrão de cada elo da cadeia (F13-12, decidido no gate). */
export const RECORDING_MODEL_DEFAULTS = {
  interview_qa: "haiku",
  interview_frames: "haiku",
  interview_report: "sonnet",
} as const;
export type RecordingModelKey = keyof typeof RECORDING_MODEL_DEFAULTS;
