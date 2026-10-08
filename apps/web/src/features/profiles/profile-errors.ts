import { describeError } from "../../components/ErrorState";
import { t } from "../../i18n";
import { ApiError } from "../../lib/api";

/** Mensagens dos erros tipados da api de perfis (F02 §2.7); o resto cai no `describeError` do F01. */
export function profileErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "profile_active":
        return t("profiles.activeCannotArchive");
      case "profile_archived":
        return t("profiles.archivedCannotActivate");
      case "profile_not_found":
        return t("profiles.notFound");
      case "analyze_pending":
        return t("profiles.analyze.pending");
      default:
        break;
    }
  }
  return describeError(error).title;
}
