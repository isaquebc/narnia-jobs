import { BRIDGE_SETTING_KEYS } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { setupPhoenix } from "../src/evals/phoenix-setup";
import { makeTestApp, type TestApp } from "./helpers";

/** M2: no boot, com o Phoenix no ar, a ponte é registrada (padrão AV-2) e os prompts sincronizados (AV-4). */
describe("setup do Phoenix no boot", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  const admin = (status: {
    reachable: boolean;
    providerRegistered: boolean;
    providerId: string | null;
  }) => {
    const calls: string[] = [];
    let s = { ...status, anthropicKeySet: false };
    return {
      calls,
      admin: {
        status: async () => s,
        registerBridge: async () => {
          calls.push("register");
          s = { ...s, providerRegistered: true, providerId: "CP9" };
        },
        setAnthropicKey: async () => undefined,
      },
    };
  };

  it("registra a ponte se faltar e sincroniza apontando para ela", async () => {
    t = makeTestApp();
    const a = admin({ reachable: true, providerRegistered: false, providerId: null });
    const seen: Array<string | null> = [];
    const r = await setupPhoenix({
      repos: t.repos,
      admin: a.admin,
      bridgeUrl: "http://api:3100/bridge/anthropic",
      sync: async (providerId) => {
        seen.push(providerId);
        return {
          prompts: [{ name: "narnia-x", action: "created" as const }],
          evaluators: {
            datasets: 8,
            evaluatorsCreated: 2,
            evaluatorsUpdated: 0,
            attached: 2,
            judgesCreated: 0,
            judgesUpdated: 0,
          },
        };
      },
      retries: 0,
    });
    expect(a.calls).toEqual(["register"]);
    expect(seen).toEqual(["CP9"]);
    expect(r).toEqual({ registered: true, synced: 3 });
  });

  it("ponte já registrada: atualiza a chave a cada boot (reset do banco gera chave nova; o Phoenix guardava a antiga e a ponte respondia 401)", async () => {
    t = makeTestApp();
    const a = admin({ reachable: true, providerRegistered: true, providerId: "CP1" });
    const keys: string[] = [];
    const inner = a.admin.registerBridge;
    a.admin.registerBridge = async (input?: { key: string }) => {
      keys.push(input?.key ?? "");
      await inner();
    };
    await setupPhoenix({
      repos: t.repos,
      admin: a.admin as never,
      bridgeUrl: "http://api:3100/bridge/anthropic",
      sync: async () => ({
        prompts: [],
        evaluators: {
          datasets: 0,
          evaluatorsCreated: 0,
          evaluatorsUpdated: 0,
          attached: 0,
          judgesCreated: 0,
          judgesUpdated: 0,
        },
      }),
      retries: 0,
    });
    expect(a.calls).toEqual(["register"]);
    expect(keys[0]).toMatch(/^narnia-ponte-/);
  });

  it("ponte desligada: não registra, mas sincroniza os prompts (sem provedor)", async () => {
    t = makeTestApp();
    t.repos.settings.set(BRIDGE_SETTING_KEYS.enabled, false);
    const a = admin({ reachable: true, providerRegistered: false, providerId: null });
    const seen: Array<string | null> = [];
    await setupPhoenix({
      repos: t.repos,
      admin: a.admin,
      bridgeUrl: "x",
      sync: async (id) => {
        seen.push(id);
        return {
          prompts: [],
          evaluators: {
            datasets: 0,
            evaluatorsCreated: 0,
            evaluatorsUpdated: 0,
            attached: 0,
            judgesCreated: 0,
            judgesUpdated: 0,
          },
        };
      },
      retries: 0,
    });
    expect(a.calls).toEqual([]);
    expect(seen).toEqual([null]);
  });

  it("Phoenix fora do ar depois das tentativas: não faz nada e não lança", async () => {
    t = makeTestApp();
    const a = admin({ reachable: false, providerRegistered: false, providerId: null });
    const r = await setupPhoenix({
      repos: t.repos,
      admin: a.admin,
      bridgeUrl: "x",
      sync: async () => {
        throw new Error("não deveria");
      },
      retries: 2,
      retryMs: 1,
    });
    expect(r).toEqual({ registered: false, synced: 0 });
  });
});
