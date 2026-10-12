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

/**
 * Nota anteposta à mensagem do usuário quando o cartão do perfil mudou desde a abertura da sessão (F04-1): o system
 * prompt é fixo, então o cartão novo entra como contexto do turno.
 */
export function cardUpdatedNote(cardText: string): string {
  return `(nota do sistema: o cartão do perfil foi atualizado desde o início desta conversa; versão atual abaixo)\n${cardText}\n(fim da nota)`;
}

/**
 * Retomada perdida (auditoria B): o transcript do provider não existe mais (volume recriado, outra pasta de config),
 * então a conversa reabre do zero; as mensagens recentes do banco vão antepostas para o recrutador não recomeçar cego.
 */
export function resumeLostNote(
  history: Array<{ role: "user" | "assistant"; text: string }>,
): string {
  const lines = history.map(
    (m) =>
      `[${m.role === "user" ? "usuário" : "recrutador"}] ${m.text.length > 600 ? `${m.text.slice(0, 599)}…` : m.text}`,
  );
  return `(nota do sistema: o histórico desta conversa não pôde ser retomado; mensagens recentes abaixo, da mais antiga para a mais nova)\n${lines.join("\n")}\n(fim da nota)`;
}

/**
 * Nota de contexto vinda de `plugin/prompts/` (auditoria E2, 19c): o texto que orienta o recrutador mora no plugin,
 * fonte única (F04-1); aqui só o preenchimento de `{{chave}}`, com a mesma regra do template (placeholder sem valor é
 * erro).
 */
export function renderNote(template: string, values: Record<string, string>): string {
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
    throw new PromptTemplateError(`Nota com placeholder sem valor: ${unknown.join(", ")}`);
  }
  return out.trim();
}
