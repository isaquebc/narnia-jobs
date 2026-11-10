import { describeError } from "../../components/ErrorState";
import { ApiError } from "../../lib/api";

/** As recusas do envio e do token já vêm com mensagem acionável em pt-BR; o resto segue o padrão do app. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status >= 400 && e.status !== 401 && e.message) return e.message;
  return describeError(e).title;
}
