import { randomBytes } from "node:crypto";
import type { SettingsRepo } from "../db/repos/settings";

/**
 * Ponte da assinatura (avaliações no Phoenix, decisão AV-2): endpoint compatível com a API de mensagens da Anthropic
 * que o Phoenix usa como provedor customizado; responde pelo Agent SDK com o login da assinatura. Ligada por padrão.
 */
export interface BridgeSettings {
  enabled: boolean;
  /** Modelo usado quando o pedido não traz um. */
  defaultModel: string;
  /** Chamadas simultâneas (cada uma abre um processo do CLI); acima disso, fila curta e depois 429. */
  concurrency: number;
}

export const DEFAULT_BRIDGE_SETTINGS: BridgeSettings = {
  enabled: true,
  defaultModel: "sonnet",
  concurrency: 2,
};

export const BRIDGE_SETTING_KEYS = {
  enabled: "bridge.enabled",
  defaultModel: "bridge.default_model",
  concurrency: "bridge.concurrency",
} as const satisfies Record<keyof BridgeSettings, string>;

const KEY_SETTING = "bridge.key";

export function resolveBridgeSettings(settings: SettingsRepo): BridgeSettings {
  const out = { ...DEFAULT_BRIDGE_SETTINGS } as Record<keyof BridgeSettings, unknown>;
  for (const [field, key] of Object.entries(BRIDGE_SETTING_KEYS) as Array<
    [keyof BridgeSettings, string]
  >) {
    const value = settings.get(key);
    if (value !== undefined) out[field] = value;
  }
  return out as unknown as BridgeSettings;
}

const newKey = () => `narnia-ponte-${randomBytes(24).toString("hex")}`;

/** Chave que o Phoenix manda em `x-api-key`; nasce no primeiro uso. */
export function bridgeKey(settings: SettingsRepo): string {
  const current = settings.get<string>(KEY_SETTING);
  if (current) return current;
  const key = newKey();
  settings.set(KEY_SETTING, key);
  return key;
}

/** Troca a chave (a antiga deixa de valer na hora; o provedor no Phoenix precisa ser registrado de novo). */
export function rotateBridgeKey(settings: SettingsRepo): string {
  const key = newKey();
  settings.set(KEY_SETTING, key);
  return key;
}
