import { BRIDGE_SETTING_KEYS, bridgeKey } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * Avaliações no Phoenix (M1, decisão AV-2): ponte da assinatura compatível com a API de mensagens da Anthropic. O
 * Phoenix usa como provedor customizado (`baseUrl` = http://api:3100/bridge/anthropic, chave em `x-api-key`).
 */
const URL = "/bridge/anthropic/v1/messages";

describe("ponte da assinatura (/bridge/anthropic/v1/messages)", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  const post = (body: unknown, key?: string, headers: Record<string, string> = {}) =>
    (t as TestApp).app.request(URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(key ? { "x-api-key": key } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const simple = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: "Seja breve.",
    messages: [{ role: "user", content: "Resuma: engenheira backend" }],
  };

  it("sem a chave da ponte (nem com o token de boot) é 401 no formato de erro da Anthropic", async () => {
    t = makeTestApp();
    const r = await post(simple);
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({
      type: "error",
      error: { type: "authentication_error" },
    });
    const boot = await post(simple, undefined, { authorization: `Bearer ${TOKEN}` });
    expect(boot.status).toBe(401);
  });

  it("sem streaming: mensagem com o texto, modelo, uso; o uso entra no medidor como avaliação", async () => {
    t = makeTestApp();
    const r = await post(simple, bridgeKey(t.repos.settings));
    expect(r.status).toBe(200);
    const m = (await r.json()) as {
      type: string;
      role: string;
      model: string;
      content: Array<{ type: string; text: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    expect(m).toMatchObject({ type: "message", role: "assistant", stop_reason: "end_turn" });
    expect(m.model).toBe("claude-sonnet-4-5");
    expect(m.content[0]?.text).toContain("Resuma: engenheira backend");
    expect(m.usage.input_tokens).toBeGreaterThan(0);
    const usage = t.repos.usageEvents.list(10);
    expect(usage[0]).toMatchObject({ category: "avaliacao.ponte", model: "claude-sonnet-4-5" });
  });

  it("chave também aceita em Authorization: Bearer (clientes compatíveis)", async () => {
    t = makeTestApp();
    const r = await post(simple, undefined, {
      authorization: `Bearer ${bridgeKey(t.repos.settings)}`,
    });
    expect(r.status).toBe(200);
  });

  it("saída estruturada (output_config.format json_schema): o texto é JSON no schema", async () => {
    t = makeTestApp();
    const r = await post(
      {
        ...simple,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { cargo: { type: "string" } },
              required: ["cargo"],
            },
          },
        },
      },
      bridgeKey(t.repos.settings),
    );
    const m = (await r.json()) as { content: Array<{ text: string }> };
    expect(JSON.parse(m.content[0]?.text ?? "")).toEqual({ cargo: "exemplo" });
  });

  it("streaming: eventos SSE na ordem da API, fragmentos que somam o texto e uso no fim", async () => {
    t = makeTestApp();
    const r = await post({ ...simple, stream: true }, bridgeKey(t.repos.settings));
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const raw = await r.text();
    const events = raw
      .split("\n\n")
      .filter((b) => b.trim())
      .map((b) => {
        const name = /^event: (.+)$/m.exec(b)?.[1];
        const data = JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "{}") as Record<string, unknown>;
        return { name, data };
      })
      .filter((e) => e.name !== "ping");
    expect(events.map((e) => e.name)).toEqual([
      "message_start",
      "content_block_start",
      ...events.filter((e) => e.name === "content_block_delta").map(() => "content_block_delta"),
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const text = events
      .filter((e) => e.name === "content_block_delta")
      .map((e) => (e.data.delta as { text: string }).text)
      .join("");
    expect(text).toContain("Resuma: engenheira backend");
    const delta = events.find((e) => e.name === "message_delta")?.data as {
      delta: { stop_reason: string };
      usage: { output_tokens: number };
    };
    expect(delta.delta.stop_reason).toBe("end_turn");
    expect(delta.usage.output_tokens).toBeGreaterThan(0);
  });

  it("histórico com várias mensagens vira transcrição; system em blocos é juntado", async () => {
    t = makeTestApp();
    const r = await post(
      {
        ...simple,
        system: [
          { type: "text", text: "Parte A." },
          { type: "text", text: "Parte B." },
        ],
        messages: [
          { role: "user", content: "primeira" },
          { role: "assistant", content: [{ type: "text", text: "resposta" }] },
          { role: "user", content: [{ type: "text", text: "segunda" }] },
        ],
      },
      bridgeKey(t.repos.settings),
    );
    const m = (await r.json()) as { content: Array<{ text: string }> };
    expect(m.content[0]?.text).toContain("Usuário: primeira");
  });

  it("parâmetros que o Agent SDK não tem são ignorados e avisados no header", async () => {
    t = makeTestApp();
    const r = await post(
      { ...simple, temperature: 0.2, top_p: 0.9, stop_sequences: ["x"] },
      bridgeKey(t.repos.settings),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("x-narnia-ignored-params")).toBe("temperature,top_p,stop_sequences");
  });

  it("várias tools à escolha do modelo: 400 explicando que a ponte não executa tools", async () => {
    t = makeTestApp();
    const r = await post(
      {
        ...simple,
        tools: [
          { name: "x", input_schema: { type: "object" } },
          { name: "y", input_schema: { type: "object" } },
        ],
      },
      bridgeKey(t.repos.settings),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({
      error: { type: "invalid_request_error", message: expect.stringContaining("tools") },
    });
  });

  const judgeTool = {
    name: "padrao_de_entrega",
    description: "Classifica a resposta",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", enum: ["atende", "parcial", "nao_atende"] },
        explanation: { type: "string" },
      },
      required: ["label", "explanation"],
    },
  };

  it("juiz do Phoenix (uma tool, ou tool forçada): vira saída estruturada e volta como tool_use", async () => {
    t = makeTestApp();
    const r = await post(
      { ...simple, tools: [judgeTool], tool_choice: { type: "any" } },
      bridgeKey(t.repos.settings),
    );
    expect(r.status).toBe(200);
    const m = (await r.json()) as {
      stop_reason: string;
      content: Array<{ type: string; name: string; id: string; input: Record<string, unknown> }>;
    };
    expect(m.stop_reason).toBe("tool_use");
    expect(m.content).toEqual([
      {
        type: "tool_use",
        id: expect.stringMatching(/^toolu_narnia_/),
        name: "padrao_de_entrega",
        input: { label: "atende", explanation: "exemplo" },
      },
    ]);
    const forced = await post(
      {
        ...simple,
        tools: [judgeTool, { name: "outra", input_schema: { type: "object" } }],
        tool_choice: { type: "tool", name: "padrao_de_entrega" },
        stream: true,
      },
      bridgeKey(t.repos.settings),
    );
    const raw = await forced.text();
    expect(raw).toContain('"type":"tool_use"');
    expect(raw).toContain('"type":"input_json_delta"');
    expect(raw).toContain('"stop_reason":"tool_use"');
  });

  it("ponte desligada em Configurações: 403 permission_error", async () => {
    t = makeTestApp();
    t.repos.settings.set(BRIDGE_SETTING_KEYS.enabled, false);
    const r = await post(simple, bridgeKey(t.repos.settings));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: { type: "permission_error" } });
  });

  it("acima da concorrência e da fila: 429 rate_limit_error (o Phoenix tenta de novo)", async () => {
    t = makeTestApp();
    t.repos.settings.set(BRIDGE_SETTING_KEYS.concurrency, 1);
    t.provider.setMode({ delayMs: 150 });
    const key = bridgeKey(t.repos.settings);
    const results = await Promise.all(Array.from({ length: 8 }, () => post(simple, key)));
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(200);
    expect(statuses).toContain(429);
    const limited = results.find((r) => r.status === 429);
    expect(await limited?.json()).toMatchObject({ error: { type: "rate_limit_error" } });
  });

  it("erro do modelo vira api_error com a mensagem", async () => {
    t = makeTestApp();
    t.provider.setMode({ errors: { complete: "Limite da assinatura atingido" } });
    const r = await post(simple, bridgeKey(t.repos.settings));
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({
      error: { type: "api_error", message: expect.stringContaining("Limite da assinatura") },
    });
  });
});
