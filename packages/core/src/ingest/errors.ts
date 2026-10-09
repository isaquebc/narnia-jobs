/** Erros tipados da ingestão (F03), mapeados para HTTP pela api: `*_not_found` → 404, `run_closed` → 409. */
export type IngestErrorCode = "run_not_found" | "run_closed" | "file_not_found" | "text_not_found";

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestError";
    this.code = code;
  }
}
