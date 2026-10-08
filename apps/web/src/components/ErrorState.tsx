import { t } from "../i18n";
import { ApiError } from "../lib/api";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

/** Estados de erro acionáveis (F01 §4 item 6): API fora, 401 por token, demais erros com mensagem do servidor. */
export function describeError(error: unknown): { title: string; hint: string | null } {
  if (error instanceof ApiError) {
    if (error.code === "network" || error.status === 0)
      return { title: t("errors.apiDown"), hint: t("errors.apiDownHint") };
    if (error.status === 401)
      return { title: t("errors.unauthorized"), hint: t("errors.unauthorizedHint") };
    if (error.status === 404) return { title: t("errors.notFound"), hint: null };
    if (error.status === 400) return { title: t("errors.validation"), hint: error.message };
    return { title: t("errors.generic", { message: error.message }), hint: null };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { title: t("errors.generic", { message }), hint: null };
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, hint } = describeError(error);
  return (
    <Alert tone="danger" className="flex flex-col gap-2">
      <p className="font-medium">{title}</p>
      {hint ? <p className="text-xs">{hint}</p> : null}
      {onRetry ? (
        <div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("app.retry")}
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}
