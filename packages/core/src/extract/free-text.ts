import { ExtractError } from "./errors";

export const MIN_FREE_TEXT_CHARS = 200;
export const MAX_FREE_TEXT_CHARS = 50_000;

/** Normaliza quebras (CRLF→LF), espaços repetidos e blocos de linhas vazias (máx. 1 linha vazia). */
export function normalizeFreeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texto livre (história profissional): entre 200 e 50k caracteres após normalização. Devolve o texto normalizado. */
export function validateFreeText(text: string): string {
  const normalized = normalizeFreeText(text);
  if (normalized.length < MIN_FREE_TEXT_CHARS) {
    throw new ExtractError(
      "too_short",
      `Texto curto demais: mínimo ${MIN_FREE_TEXT_CHARS} caracteres`,
    );
  }
  if (normalized.length > MAX_FREE_TEXT_CHARS) {
    throw new ExtractError(
      "too_long",
      `Texto longo demais: máximo ${MAX_FREE_TEXT_CHARS} caracteres`,
    );
  }
  return normalized;
}
