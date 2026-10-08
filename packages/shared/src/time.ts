import moment from "moment-timezone/builds/moment-timezone-with-data-10-year-range";
import { isValidTimeZone } from "./schemas/common";

/**
 * Tempo (decisões F01-16 e `03 §17`): todo instante é gravado em UTC (ISO 8601) e convertido para o fuso
 * do usuário só na exibição. `moment-timezone` fica isolado aqui para troca futura sem tocar em componentes.
 * Datas sem hora (YYYY, YYYY-MM, YYYY-MM-DD) nunca sofrem conversão de fuso.
 */

export { isValidTimeZone };

export const DEFAULT_DATETIME_FORMAT = "DD/MM/YYYY HH:mm";

export function nowUtc(): string {
  return new Date().toISOString();
}

export function toUtcIso(input: Date | number | string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Data inválida: ${String(input)}`);
  }
  return date.toISOString();
}

export function formatInUserTz(
  iso: string,
  timeZone: string,
  format: string = DEFAULT_DATETIME_FORMAT,
): string {
  if (!isValidTimeZone(timeZone)) {
    throw new TypeError(`Fuso horário inválido: ${timeZone}`);
  }
  const m = moment.utc(iso);
  if (!m.isValid()) {
    throw new TypeError(`Instante inválido: ${iso}`);
  }
  return m.tz(timeZone).format(format);
}

const DATE_ONLY = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** Formata uma data sem hora no padrão do locale, preservando a precisão (ano, mês ou dia). Sem fuso. */
export function formatDateOnly(value: string, locale: "pt-BR" | "en-US" = "pt-BR"): string {
  if (!isDateOnly(value)) {
    throw new TypeError(`Data sem hora inválida: ${value}`);
  }
  const [year, month, day] = value.split("-");
  if (!month) return year as string;
  const monthFirst = locale === "en-US";
  if (!day) return `${month}/${year}`;
  return monthFirst ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}
