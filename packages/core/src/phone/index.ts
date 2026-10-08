import type { Phone } from "@narnia-jobs/shared";
import {
  type CountryCode,
  isSupportedCountry,
  ParseError,
  parsePhoneNumberWithError,
  validatePhoneNumberLength,
} from "libphonenumber-js";

export type PhoneErrorCode = "invalid_country" | "too_short" | "too_long" | "invalid_number";

export class PhoneError extends Error {
  readonly code: PhoneErrorCode;
  constructor(code: PhoneErrorCode, message: string) {
    super(message);
    this.name = "PhoneError";
    this.code = code;
  }
}

export interface PhoneInput {
  /** País em ISO-3166 alpha-2 (ex.: BR). */
  country: string;
  /** DDD + número, com ou sem formatação. */
  national: string;
}

/** Valida país + DDD + número e devolve E.164 com as partes (F01 §3, telefone obrigatório). */
export function parsePhone(input: PhoneInput): Phone {
  const country = input.country.trim().toUpperCase();
  if (!isSupportedCountry(country)) {
    throw new PhoneError("invalid_country", `País desconhecido: ${input.country}`);
  }
  const digits = input.national.replace(/\D/g, "");
  const lengthIssue = validatePhoneNumberLength(digits, country as CountryCode);
  if (lengthIssue === "TOO_SHORT" || lengthIssue === "NOT_A_NUMBER") {
    throw new PhoneError("too_short", "Número curto demais");
  }
  if (lengthIssue === "TOO_LONG") throw new PhoneError("too_long", "Número longo demais");
  let parsed: ReturnType<typeof parsePhoneNumberWithError>;
  try {
    parsed = parsePhoneNumberWithError(digits, country as CountryCode);
  } catch (e) {
    if (e instanceof ParseError) {
      if (e.message === "TOO_SHORT") throw new PhoneError("too_short", "Número curto demais");
      if (e.message === "TOO_LONG") throw new PhoneError("too_long", "Número longo demais");
    }
    throw new PhoneError("invalid_number", "Número inválido para o país");
  }
  if (parsed.country !== country || !parsed.isValid()) {
    throw new PhoneError("invalid_number", "Número inválido para o país (verifique o DDD)");
  }
  return { e164: parsed.number, country, national: parsed.nationalNumber };
}

/** Formato de exibição: nacional no mercado do próprio país (pt-BR) ou internacional (demais). */
export function formatPhone(e164: string, locale: "pt-BR" | "en-US" = "pt-BR"): string {
  const parsed = parsePhoneNumberWithError(e164);
  if (locale === "pt-BR" && parsed.country === "BR") return parsed.formatNational();
  return parsed.formatInternational();
}
