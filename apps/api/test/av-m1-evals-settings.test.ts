import { BRIDGE_SETTING_KEYS, bridgeKey } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPhoenixAdmin,
  PHOENIX_BRIDGE_PROVIDER,
  phoenixBaseUrl,
} from "../src/evals/phoenix-admin";
import { evalsSettingsRoutes } from "../src/routes/evals-settings";
import { makeTestApp, type TestApp } from "./helpers";

/** Avaliações no Phoenix (M1): Configurações › Avaliações e o registro da ponte no Phoenix. */
function fakePhoenix(
  opts: { providers?: Array<{ id: string; name: string }>; down?: boolean } = {},
) {
  const calls: Array<{ url: string; body: Record<string, unknown> | null; method: string }> = [];
  const providers = [...(opts.providers ?? [])];
  let secretSet = false;
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (opts.down) throw new Error("ECONNREFUSED");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body, method: init?.method ?? "GET" });
    if (url.endsWith("/v1/secrets")) {
      const s = ((body?.secrets ?? []) as Array<{ value: string | null }>)[0];
      secretSet = s?.value !== null;
      return Response.json({ data: { upserted_keys: [], deleted_keys: [] } });
    }
    const q = String(body?.query ?? "");
    if (q.includes("createGenerativeModelCustomProvider")) {
      providers.push({ id: "P2", name: PHOENIX_BRIDGE_PROVIDER });
      return Response.json({
        data: { createGenerativeModelCustomProvider: { provider: { id: "P2" } } },
      });
    }
    if (q.includes("patchGenerativeModelCustomProvider"))
      return Response.json({
        data: { patchGenerativeModelCustomProvider: { provider: { id: "P1" } } },
      });
    return Response.json({
      data: {
        generativeModelCustomProviders: { edges: providers.map((node) => ({ node })) },
        secrets: { edges: secretSet ? [{ node: { key: "ANTHROPIC_API_KEY" } }] : [] },
      },
    });
  };
  return { calls, fetch: fetchFn };
}

describe("Phoenix: endereço e administração", () => {
  it("endereço do Phoenix: NARNIA_PHOENIX_URL ou a origem do endpoint OTLP; nenhum = null", () => {
    expect(phoenixBaseUrl({ NARNIA_PHOENIX_URL: "http://px:6006/" })).toBe("http://px:6006");
    expect(phoenixBaseUrl({ NARNIA_OTEL_ENDPOINT: "http://phoenix:6006/v1/traces" })).toBe(
      "http://phoenix:6006",
    );
    expect(phoenixBaseUrl({})).toBeNull();
  });

  it("registra a ponte como provedor Anthropic customizado; já existindo, atualiza (chave nova)", async () => {
    const px = fakePhoenix();
    const admin = createPhoenixAdmin({ baseUrl: "http://phoenix:6006", fetch: px.fetch });
    await admin.registerBridge({ key: "k1", bridgeUrl: "http://api:3100/bridge/anthropic" });
    const create = px.calls.find((c) =>
      String(c.body?.query).includes("createGenerativeModelCustomProvider"),
    );
    expect(create?.url).toBe("http://phoenix:6006/graphql");
    expect(create?.body?.variables).toEqual({
      input: {
        name: PHOENIX_BRIDGE_PROVIDER,
        description: expect.stringContaining("assinatura"),
        provider: "anthropic",
        clientConfig: {
          anthropic: {
            anthropicAuthenticationMethod: { apiKey: "k1" },
            anthropicClientKwargs: { baseUrl: "http://api:3100/bridge/anthropic" },
          },
        },
      },
    });
    const again = fakePhoenix({ providers: [{ id: "P1", name: PHOENIX_BRIDGE_PROVIDER }] });
    await createPhoenixAdmin({ baseUrl: "http://phoenix:6006", fetch: again.fetch }).registerBridge(
      { key: "k2", bridgeUrl: "http://api:3100/bridge/anthropic" },
    );
    const patch = again.calls.find((c) =>
      String(c.body?.query).includes("patchGenerativeModelCustomProvider"),
    );
    const vars = patch?.body?.variables as { input: { id: string } } | undefined;
    expect(vars?.input.id).toBe("P1");
  });

  it("status: alcançável, provedor registrado e chave de API; Phoenix fora do ar = não alcançável", async () => {
    const px = fakePhoenix({ providers: [{ id: "P1", name: PHOENIX_BRIDGE_PROVIDER }] });
    const admin = createPhoenixAdmin({ baseUrl: "http://phoenix:6006", fetch: px.fetch });
    expect(await admin.status()).toEqual({
      reachable: true,
      providerRegistered: true,
      providerId: "P1",
      anthropicKeySet: false,
    });
    await admin.setAnthropicKey("sk-ant-x");
    expect(px.calls.at(-1)).toMatchObject({
      method: "PUT",
      url: "http://phoenix:6006/v1/secrets",
      body: { secrets: [{ key: "ANTHROPIC_API_KEY", value: "sk-ant-x" }] },
    });
    expect((await admin.status()).anthropicKeySet).toBe(true);
    const down = createPhoenixAdmin({
      baseUrl: "http://phoenix:6006",
      fetch: fakePhoenix({ down: true }).fetch,
    });
    expect(await down.status()).toEqual({
      reachable: false,
      providerRegistered: false,
      providerId: null,
      anthropicKeySet: false,
    });
  });
});

describe("Configurações › Avaliações (/api/settings/evals)", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  const mount = (phoenix: ReturnType<typeof fakePhoenix> | null) => {
    t = makeTestApp();
    const app = evalsSettingsRoutes({
      repos: t.repos,
      bridgeUrl: "http://api:3100/bridge/anthropic",
      phoenixUrl: phoenix ? "http://phoenix:6006" : null,
      admin: phoenix
        ? createPhoenixAdmin({ baseUrl: "http://phoenix:6006", fetch: phoenix.fetch })
        : null,
      syncPrompts: async () => ({
        prompts: [
          { name: "narnia-extract-facts", action: "created" as const },
          { name: "narnia-recrutador", action: "unchanged" as const },
        ],
        evaluators: {
          datasets: 8,
          evaluatorsCreated: 27,
          evaluatorsUpdated: 0,
          attached: 27,
          judgesCreated: 0,
          judgesUpdated: 0,
        },
      }),
    });
    return (path: string, init?: RequestInit) => app.request(path, init);
  };
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("GET: ponte (padrões, chave, endereço visto pelo Phoenix) e estado do Phoenix", async () => {
    const call = mount(fakePhoenix());
    const r = await (await call("/api/settings/evals")).json();
    expect(r).toEqual({
      bridge: {
        settings: { enabled: true, defaultModel: "sonnet", concurrency: 2 },
        key: bridgeKey((t as TestApp).repos.settings),
        url: "http://api:3100/bridge/anthropic",
      },
      phoenix: {
        url: "http://phoenix:6006",
        reachable: true,
        providerName: "narnia-assinatura",
        providerRegistered: false,
        anthropicKeySet: false,
      },
      prompts: { count: 32, lastSync: null },
    });
  });

  it("sem Phoenix configurado: estado não alcançável e registrar devolve 409 phoenix_unavailable", async () => {
    const call = mount(null);
    const r = (await (await call("/api/settings/evals")).json()) as { phoenix: unknown };
    expect(r.phoenix).toMatchObject({ url: null, reachable: false });
    const reg = await call("/api/settings/evals/phoenix/register", { method: "POST" });
    expect(reg.status).toBe(409);
    expect(await reg.json()).toMatchObject({ error: { code: "phoenix_unavailable" } });
  });

  it("PUT da ponte valida e grava; concorrência fora de 1–8 é 400", async () => {
    const call = mount(fakePhoenix());
    const ok = await call(
      "/api/settings/evals/bridge",
      json("PUT", { enabled: false, concurrency: 3 }),
    );
    expect(((await ok.json()) as { bridge: { settings: unknown } }).bridge.settings).toEqual({
      enabled: false,
      defaultModel: "sonnet",
      concurrency: 3,
    });
    expect((t as TestApp).repos.settings.get(BRIDGE_SETTING_KEYS.enabled)).toBe(false);
    const bad = await call("/api/settings/evals/bridge", json("PUT", { concurrency: 50 }));
    expect(bad.status).toBe(400);
  });

  it("trocar a chave registra de novo no Phoenix quando o provedor já existe", async () => {
    const px = fakePhoenix({ providers: [{ id: "P1", name: PHOENIX_BRIDGE_PROVIDER }] });
    const call = mount(px);
    const old = bridgeKey((t as TestApp).repos.settings);
    const r = (await (
      await call("/api/settings/evals/bridge/rotate-key", { method: "POST" })
    ).json()) as {
      bridge: { key: string };
    };
    expect(r.bridge.key).not.toBe(old);
    const patch = px.calls.find((c) =>
      String(c.body?.query).includes("patchGenerativeModelCustomProvider"),
    );
    expect(JSON.stringify(patch?.body?.variables)).toContain(r.bridge.key);
  });

  it("registrar e guardar/apagar a chave de API da Anthropic no Phoenix", async () => {
    const px = fakePhoenix();
    const call = mount(px);
    const reg = (await (
      await call("/api/settings/evals/phoenix/register", { method: "POST" })
    ).json()) as {
      phoenix: { providerRegistered: boolean };
    };
    expect(reg.phoenix.providerRegistered).toBe(true);
    const set = (await (
      await call("/api/settings/evals/phoenix/anthropic-key", json("PUT", { apiKey: "sk-ant-1" }))
    ).json()) as { phoenix: { anthropicKeySet: boolean } };
    expect(set.phoenix.anthropicKeySet).toBe(true);
    const del = (await (
      await call("/api/settings/evals/phoenix/anthropic-key", json("PUT", { apiKey: null }))
    ).json()) as { phoenix: { anthropicKeySet: boolean } };
    expect(del.phoenix.anthropicKeySet).toBe(false);
  });

  it("sincronizar prompts: resumo da última sincronização guardado; sem Phoenix, 409", async () => {
    const call = mount(fakePhoenix());
    const r = (await (
      await call("/api/settings/evals/prompts/sync", { method: "POST" })
    ).json()) as {
      prompts: { count: number; lastSync: Record<string, unknown> };
    };
    expect(r.prompts.lastSync).toEqual({
      at: expect.any(String),
      created: 1,
      updated: 0,
      unchanged: 1,
      datasets: 8,
      evaluatorsCreated: 27,
      evaluatorsUpdated: 0,
      error: null,
    });
    const again = (await (await call("/api/settings/evals")).json()) as { prompts: unknown };
    expect(again.prompts).toEqual(r.prompts);
    const none = mount(null);
    expect((await none("/api/settings/evals/prompts/sync", { method: "POST" })).status).toBe(409);
  });
});
