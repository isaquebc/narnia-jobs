import { z } from "zod";
import {
  IdSchema,
  IsoCountrySchema,
  IsoDateTimeSchema,
  LinkSchema,
  RemotePrefSchema,
  TimeZoneSchema,
} from "./common";

export const PhoneSchema = z.object({
  e164: z.string().regex(/^\+[1-9]\d{6,14}$/, "Telefone em E.164 (+5511999999999)"),
  country: IsoCountrySchema,
  national: z.string().regex(/^\d{4,15}$/, "DDD + número, só dígitos"),
});
export type Phone = z.infer<typeof PhoneSchema>;

export const RelocationSchema = z.object({
  mode: z.enum(["none", "country", "anywhere"]),
  countries: z.array(IsoCountrySchema),
});
export type Relocation = z.infer<typeof RelocationSchema>;

export const WorkAuthStatusSchema = z.enum([
  "citizen",
  "permanent_resident",
  "work_visa",
  "needs_sponsorship",
  "not_authorized",
]);

export const WorkAuthSchema = z.object({
  country: IsoCountrySchema,
  status: WorkAuthStatusSchema,
  notes: z.string().optional(),
});
export type WorkAuth = z.infer<typeof WorkAuthSchema>;

/** Identidade e contato (F01 §3 `user`). Telefone, cidade, país, relocação e situação de trabalho são obrigatórios. */
export const UserSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  fullName: z.string().min(1),
  pronouns: z.string().optional(),
  email: z.email(),
  phone: PhoneSchema,
  city: z.string().min(1),
  region: z.string().optional(),
  country: IsoCountrySchema,
  timezone: TimeZoneSchema,
  remotePref: RemotePrefSchema,
  relocation: RelocationSchema,
  workAuth: z.array(WorkAuthSchema).min(1),
  links: z.array(LinkSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;
