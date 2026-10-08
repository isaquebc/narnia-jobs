import {
  PERSONA_DEFAULTS,
  type Persona,
  type PersonaOverrides,
  PersonaOverridesSchema,
  PersonaSchema,
  type Profile,
} from "@narnia-jobs/shared";

/**
 * Persona do recrutador derivada do perfil (F02 §2.4, decisão F02-7): enums com padrão (tom direto, honestidade
 * máxima, rigor alto, recrutador sênior), sobrescritos só nos campos informados; `null` restaura o padrão.
 * O texto do system prompt é montado em F04 a partir deste objeto.
 */
export type PersonaProfile = Pick<
  Profile,
  "area" | "targetTitle" | "seniority" | "market" | "docLocale" | "personaOverrides"
>;

export function buildPersona(profile: PersonaProfile, extra: PersonaOverrides = {}): Persona {
  const derived: Persona = {
    specialty: `${profile.area} · ${profile.targetTitle}`,
    targetLevel: profile.seniority,
    market: profile.market,
    language: profile.docLocale,
    ...PERSONA_DEFAULTS,
  };
  const merged: Record<string, unknown> = { ...derived };
  for (const source of [profile.personaOverrides ?? {}, extra]) {
    for (const [k, v] of Object.entries(PersonaOverridesSchema.parse(source))) {
      if (v === undefined) continue;
      merged[k] = v === null ? derived[k as keyof Persona] : v;
    }
  }
  return PersonaSchema.parse(merged);
}
