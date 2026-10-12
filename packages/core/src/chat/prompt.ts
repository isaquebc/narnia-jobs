import type { Persona, TrustedDomain } from "@narnia-jobs/shared";

/**
 * Prompt do recrutador a partir do template do plugin (`plugin/agents/recrutador.md`), fonte única do texto (F04-1):
 * o `api` usa no `systemPrompt` do modo A e na rota do hook do modo B. Aqui só o preenchimento; quem lê o arquivo é o
 * chamador. Placeholders: `{{persona.<campo>}}`, `{{card}}` e `{{trusted_domains}}`. Placeholder desconhecido ou que
 * sobra é erro (um prompt com `{{…}}` cru mudaria o comportamento do agente sem ninguém ver).
 */
export interface RecruiterPromptInput {
  persona: Persona;
  card: string;
  trustedDomains: TrustedDomain[];
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z_.]+)\s*\}\}/g;

export class PromptTemplateError extends Error {}

export function renderRecruiterPrompt(template: string, input: RecruiterPromptInput): string {
  const domains = input.trustedDomains
    .filter((d) => d.enabled)
    .map((d) => d.pattern)
    .join(", ");
  const values: Record<string, string> = {
    card: input.card,
    trusted_domains: domains,
  };
  for (const [k, v] of Object.entries(input.persona)) values[`persona.${k}`] = String(v);
  const unknown: string[] = [];
  const out = template.replace(PLACEHOLDER, (whole, key: string) => {
    const v = values[key];
    if (v === undefined) {
      unknown.push(key);
      return whole;
    }
    return v;
  });
  if (unknown.length > 0) {
    throw new PromptTemplateError(`Template com placeholder sem valor: ${unknown.join(", ")}`);
  }
  return out;
}
