import { describe, expect, it } from "vitest";
import {
  type ChatEvent,
  type ChatOpenOptions,
  type ChatQueryFn,
  ClaudeCodeProvider,
  MockProvider,
  normalizeSdkChatMessage,
  type SdkChatMessageLike,
} from "../src/index";

/**
 * Auditoria pós-F04 · bloco B (2026-10-12): o que só aparece com o Claude real. Erro de API que chega como "success",
 * turno interrompido, separação de blocos de texto, opções do SDK (prompt sem snapshot, MCP carregado no turno 1,
 * plugin sem descobrir MCP próprio) e o "Parar" do mock.
 */

const BASE: ChatOpenOptions = {
  systemPrompt: "persona + cartão",
  model: "sonnet",
  maxTurns: 8,
  maxBudgetUsd: null,
  mcp: { url: "http://127.0.0.1:3100/mcp", headers: { Authorization: "Bearer t" } },
  pluginDir: "/app/plugin",
  tools: ["WebSearch"],
  category: "career",
};

const usage = { input_tokens: 10, output_tokens: 2 };

describe("auditoria B · normalizador", () => {
  it("result success com is_error vira erro com o texto da API, não resposta do recrutador", () => {
    const [e] = normalizeSdkChatMessage(
      {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Failed to authenticate: OAuth session expired and could not be refreshed",
        usage,
        total_cost_usd: 0.01,
      },
      "sonnet",
    );
    expect(e).toMatchObject({
      type: "error",
      message: "Failed to authenticate: OAuth session expired and could not be refreshed",
      costUsd: 0.01,
    });
    expect(e?.type === "error" && e.usage?.inputTokens).toBe(10);
  });

  it("result com terminal_reason aborted_* fecha o turno como interrompido (qualquer subtype)", () => {
    for (const m of [
      {
        type: "result",
        subtype: "success",
        result: "parcial",
        terminal_reason: "aborted_streaming",
      },
      { type: "result", subtype: "error_during_execution", terminal_reason: "aborted_tools" },
    ] as SdkChatMessageLike[]) {
      const [e] = normalizeSdkChatMessage({ ...m, usage, total_cost_usd: 0.02 }, "sonnet");
      expect(e).toMatchObject({ type: "turn_end", interrupted: true, costUsd: 0.02 });
    }
  });

  it("início de um bloco de texto vira text_break (separa narração e resposta final)", () => {
    expect(
      normalizeSdkChatMessage(
        {
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "text" } },
        },
        "sonnet",
      ),
    ).toEqual([{ type: "text_break" }]);
    expect(
      normalizeSdkChatMessage(
        {
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "tool_use" } },
        },
        "sonnet",
      ),
    ).toEqual([]);
  });
});

describe("auditoria B · opções do SDK no chat", () => {
  it("system prompt sem snapshot, MCP com alwaysLoad e plugin com skipMcpDiscovery", async () => {
    let captured: Record<string, unknown> = {};
    const chatQuery: ChatQueryFn = ({ options }) => {
      captured = options as unknown as Record<string, unknown>;
      async function* run() {}
      const it = run();
      return Object.assign(it, {
        interrupt: async () => undefined,
        setModel: async () => undefined,
        close: () => undefined,
      });
    };
    const p = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      chatQuery,
      binaryPath: "/bin/claude",
    });
    const chat = p.openChat(BASE);
    for await (const _ of chat.events) break;
    chat.close();
    expect(captured.systemPrompt).toEqual({
      type: "custom",
      prompt: "persona + cartão",
      snapshot: false,
    });
    expect(captured.mcpServers).toMatchObject({
      "narnia-jobs": { type: "http", alwaysLoad: true },
    });
    expect(captured.plugins).toEqual([
      { type: "local", path: "/app/plugin", skipMcpDiscovery: true },
    ]);
  });
});

describe("auditoria B · MockProvider.interrupt", () => {
  it("parar no meio do turno fecha o turno como interrompido, sem erro", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ text: "{}" }] } }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    const p = new MockProvider({ delayMs: 200 });
    const chat = p.openChat({ ...BASE, fetch: fetchFn });
    chat.send("o que está fraco?");
    setTimeout(() => void chat.interrupt(), 20);
    const out: ChatEvent[] = [];
    for await (const e of chat.events) {
      out.push(e);
      if (e.type === "turn_end" || e.type === "error") break;
    }
    chat.close();
    expect(out.at(-1)).toMatchObject({ type: "turn_end", interrupted: true });
    expect(out.some((e) => e.type === "error")).toBe(false);
  });
});
