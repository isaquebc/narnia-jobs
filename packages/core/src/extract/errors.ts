export type ExtractErrorCode = "too_large" | "too_short" | "too_long" | "unsupported" | "corrupt";

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
  }
}
