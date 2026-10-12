export type ProfileErrorCode =
  | "profile_not_found"
  | "profile_active"
  | "profile_archived"
  | "fact_not_found"
  | "fact_foreign"
  | "unsupported_kind"
  | "suggestion_not_found"
  | "profile_not_in_session";

/** Erros tipados do domínio de perfis (F02); a api mapeia `code` para 404/409/400. */
export class ProfileError extends Error {
  readonly code: ProfileErrorCode;
  constructor(code: ProfileErrorCode, message: string) {
    super(message);
    this.name = "ProfileError";
    this.code = code;
  }
}
