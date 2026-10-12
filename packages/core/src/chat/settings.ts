import type { SettingsRepo } from "../db/repos/settings";

/**
 * Preferências do chat (F04 §2.10-7), com os padrões decididos pelo dono (F04-3, F04-4, F04-9). Cada chave pode ser
 * sobrescrita em Configurações; ausente = padrão.
 */
export interface ChatSettings {
  /** F04-3: sessões vivas simultâneas; ao atingir o teto a UI pergunta qual encerrar. */
  maxLiveSessions: number;
  /** F04-4: minutos sem atividade até hibernar a sessão (o `resume` a retoma). */
  hibernateAfterMin: number;
  /** Turnos do agente por mensagem do usuário. */
  maxTurns: number;
  /** F04-9: modelo padrão de uma sessão nova (cada sessão pode trocar). */
  defaultModel: string;
  /** Teto de custo por sessão em USD (`maxBudgetUsd` do SDK); nulo = sem teto. */
  maxBudgetUsd: number | null;
  /** F04-5: `research.save` só aceita domínios da lista confiável. */
  requireTrustedResearch: boolean;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  maxLiveSessions: 5,
  hibernateAfterMin: 60,
  maxTurns: 8,
  defaultModel: "sonnet",
  maxBudgetUsd: null,
  requireTrustedResearch: true,
};

export const CHAT_SETTING_KEYS = {
  maxLiveSessions: "chat.max_live_sessions",
  hibernateAfterMin: "chat.hibernate_after_min",
  maxTurns: "chat.max_turns",
  defaultModel: "chat.default_model",
  maxBudgetUsd: "chat.max_budget_usd",
  requireTrustedResearch: "research.require_trusted",
} as const satisfies Record<keyof ChatSettings, string>;

export function resolveChatSettings(settings: SettingsRepo): ChatSettings {
  const out = { ...DEFAULT_CHAT_SETTINGS } as Record<keyof ChatSettings, unknown>;
  for (const [field, key] of Object.entries(CHAT_SETTING_KEYS) as Array<
    [keyof ChatSettings, string]
  >) {
    const value = settings.get(key);
    if (value !== undefined) out[field] = value;
  }
  return out as unknown as ChatSettings;
}
