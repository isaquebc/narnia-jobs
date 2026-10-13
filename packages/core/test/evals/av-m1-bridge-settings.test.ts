import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  BRIDGE_SETTING_KEYS,
  bridgeKey,
  DEFAULT_BRIDGE_SETTINGS,
  resolveBridgeSettings,
  rotateBridgeKey,
} from "../../src/evals/bridge-settings";

/** Avaliações no Phoenix (M1): preferências da ponte da assinatura e a chave dela. */
describe("ponte da assinatura · configurações", () => {
  const repos = () => {
    const db = openDatabase(":memory:");
    migrate(db);
    return createRepos(db);
  };

  it("padrões: ligada (decisão AV-2), sonnet, 2 chamadas por vez; cada chave sobrescreve", () => {
    const r = repos();
    expect(DEFAULT_BRIDGE_SETTINGS).toEqual({
      enabled: true,
      defaultModel: "sonnet",
      concurrency: 2,
    });
    expect(resolveBridgeSettings(r.settings)).toEqual(DEFAULT_BRIDGE_SETTINGS);
    r.settings.set(BRIDGE_SETTING_KEYS.enabled, false);
    r.settings.set(BRIDGE_SETTING_KEYS.concurrency, 4);
    expect(resolveBridgeSettings(r.settings)).toMatchObject({ enabled: false, concurrency: 4 });
  });

  it("a chave nasce no primeiro uso, fica estável e muda só ao trocar", () => {
    const r = repos();
    const k = bridgeKey(r.settings);
    expect(k).toMatch(/^narnia-ponte-[0-9a-f]{48}$/);
    expect(bridgeKey(r.settings)).toBe(k);
    const k2 = rotateBridgeKey(r.settings);
    expect(k2).not.toBe(k);
    expect(bridgeKey(r.settings)).toBe(k2);
  });
});
