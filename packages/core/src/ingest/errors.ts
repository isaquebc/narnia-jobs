/**
 * Erros tipados da ingestão (F03), mapeados para HTTP pela api: `*_not_found` → 404, `run_closed` e
 * `invalid_state` → 409.
 */
export type IngestErrorCode =
  | "run_not_found"
  | "run_closed"
  | "file_not_found"
  | "text_not_found"
  | "invalid_state";

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestError";
    this.code = code;
  }
}
