import { z } from "zod";

/** Blocos reutilizados pelos schemas. Tudo em camelCase; o `core` mapeia para snake_case no SQLite. */

export const IsoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .describe("Instante em ISO 8601 (UTC)");

/** Data sem hora, com precisão de mês ou dia: YYYY-MM ou YYYY-MM-DD (ou só YYYY para formação antiga). */
export const PartialDateSchema = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Use YYYY, YYYY-MM ou YYYY-MM-DD");

export const IsoCountrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "País em ISO-3166 alpha-2 maiúsculo");
export const IsoCurrencySchema = z.string().regex(/^[A-Z]{3}$/, "Moeda em ISO-4217");
export const ConfidenceSchema = z.number().min(0).max(1);
export const IdSchema = z.string().min(1);
export const UrlSchema = z.url();

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z.string().refine(isValidTimeZone, "Fuso horário IANA inválido");

export const LinkSchema = z.object({
  label: z.string().min(1),
  url: UrlSchema,
});
export type Link = z.infer<typeof LinkSchema>;

export const RemotePrefSchema = z.enum(["remote", "hybrid", "onsite", "any"]);
export type RemotePref = z.infer<typeof RemotePrefSchema>;
