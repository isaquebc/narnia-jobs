/** Tarefas da F05 (§2.7) na fila `extract` e os modelos padrão por tarefa (F05-13: Sonnet gera, Haiku revisa). */
export const DOCUMENT_TASKS = {
  generate: "cv.generate",
  render: "cv.render",
} as const;

export const DOCUMENT_MODEL_DEFAULTS = {
  cv_generate: "sonnet",
  cv_review: "haiku",
} as const;
export type DocumentModelKey = keyof typeof DOCUMENT_MODEL_DEFAULTS;

/** Tentativas por clique em "Atualizar": a geração e uma regeração automática com os apontamentos (F05-13). */
export const DOCUMENT_MAX_ATTEMPTS = 2;

/** Pasta dos arquivos de uma versão, relativa à pasta de dados. */
export const documentVersionDir = (documentId: string, version: number) =>
  `documents/${documentId}/v${version}`;
