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

/** F04 M3 · sessão longa de chat: normalização dos eventos do SDK, `openChat` (Claude Code e mock com roteiros). */

const BASE: ChatOpenOptions = {
  systemPrompt: "persona + cartão",
  model: "sonnet",
  maxTurns: 8,
  maxBudgetUsd: null,
  mcp: {
    url: "http://127.0.0.1:3100/mcp",
    headers: { Authorization: "Bearer t", "X-Narnia-Session": "s1" },
  },
  pluginDir: "/app/plugin",
  tools: ["WebSearch", "WebFetch"],
  env: { NARNIA_SESSION_HAS_CARD: "1" },
  category: "career",
};

async function take(events: AsyncIterable<ChatEvent>, until: (e: ChatEvent) => boolean) {
  const out: ChatEvent[] = [];
  for await (const e of events) {
    out.push(e);
    if (until(e)) break;
  }
  return out;
}

describe("normalizeSdkChatMessage", () => {
  it("init, delta, tool_use, tool_result e result de sucesso viram eventos de chat", () => {
    const msgs: SdkChatMessageLike[] = [
      { type: "system", subtype: "init", session_id: "sdk-1" },
      {
        type: "stream_event",
        session_id: "sdk-1",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Olá" } },
      },
      {
        type: "assistant",
        session_id: "sdk-1",
        message: {
          id: "msg_1",
          model: "claude-sonnet-4-5-20250929",
          usage: { input_tokens: 1100, output_tokens: 40, cache_read_input_tokens: 900 },
          content: [
            { type: "text", text: "Olá" },
            {
              type: "tool_use",
              id: "tu1",
              name: "mcp__narnia-jobs__evidence_experience_list",
              input: { limit: 5 },
            },
          ],
        },
      },
      {
        type: "user",
        session_id: "sdk-1",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              is_error: false,
              content: [{ type: "text", text: '{"items":[]}' }],
            },
          ],
        },
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sdk-1",
        result: "Olá, Ana.",
        usage: {
          input_tokens: 1200,
          output_tokens: 80,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 10,
        },
        total_cost_usd: 0.012,
      },
    ];
    const events = msgs.flatMap((m) => normalizeSdkChatMessage(m, "sonnet"));
    expect(events).toEqual([
      { type: "init", providerSessionId: "sdk-1" },
      { type: "delta", text: "Olá" },
      {
        type: "llm_message",
        messageId: "msg_1",
        model: "claude-sonnet-4-5-20250929",
        usage: {
          inputTokens: 1100,
          outputTokens: 40,
          cacheReadTokens: 900,
          cacheWriteTokens: 0,
          model: "claude-sonnet-4-5-20250929",
        },
      },
      {
        type: "tool_start",
        id: "tu1",
        name: "evidence_experience_list",
        args: '{"limit":5}',
        input: '{"limit":5}',
      },
      { type: "tool_end", id: "tu1", isError: false, output: '{"items":[]}' },
      {
        type: "turn_end",
        text: "Olá, Ana.",
        providerSessionId: "sdk-1",
        costUsd: 0.012,
        usage: {
          inputTokens: 1200,
          outputTokens: 80,
          cacheReadTokens: 900,
          cacheWriteTokens: 10,
          model: "sonnet",
        },
      },
    ]);
  });

  it("estouro de turnos e de orçamento viram limit; erro de execução vira error", () => {
    const usage = { input_tokens: 1, output_tokens: 1 };
    expect(
      normalizeSdkChatMessage({ type: "result", subtype: "error_max_turns", usage }, "s")[0],
    ).toMatchObject({
      type: "limit",
      reason: "max_turns",
    });
    expect(
      normalizeSdkChatMessage({ type: "result", subtype: "error_max_budget_usd", usage }, "s")[0],
    ).toMatchObject({ type: "limit", reason: "max_budget" });
    expect(
      normalizeSdkChatMessage(
        { type: "result", subtype: "error_during_execution", usage, errors: ["processo caiu"] },
        "s",
      )[0],
    ).toMatchObject({ type: "error", message: "processo caiu" });
  });

  it("argumentos longos da tool são resumidos em até 500 caracteres", () => {
    const [e] = normalizeSdkChatMessage(
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "x", name: "ingest_text", input: { text: "a".repeat(2000) } },
          ],
        },
      },
      "s",
    );
    expect(e?.type === "tool_start" && e.args.length).toBeLessThanOrEqual(500);
    // o rastro leva a entrada inteira (até o corte do clip)
    expect(e?.type === "tool_start" && e.input.length).toBeGreaterThan(2000);
  });

  it("resultado da tool em texto puro também vai no tool_end", () => {
    expect(
      normalizeSdkChatMessage(
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "x", is_error: true, content: "negado" }],
          },
        },
        "s",
      ),
    ).toEqual([{ type: "tool_end", id: "x", isError: true, output: "negado" }]);
  });
});

describe("ClaudeCodeProvider.openChat", () => {
  it("abre o query com entrada em streaming e as opções da sessão; send empurra mensagens do usuário", async () => {
    const captured: { options?: Record<string, unknown>; inputs: string[] } = { inputs: [] };
    const chatQuery: ChatQueryFn = ({ prompt, options }) => {
      captured.options = options as unknown as Record<string, unknown>;
      async function* run() {
        yield { type: "system", subtype: "init", session_id: "sdk-9" } as SdkChatMessageLike;
        for await (const m of prompt) {
          const content = (m.message as { content: string }).content;
          captured.inputs.push(content);
          yield {
            type: "result",
            subtype: "success",
            session_id: "sdk-9",
            result: `eco: ${content}`,
            usage: { input_tokens: 10, output_tokens: 2 },
            total_cost_usd: 0,
          } as SdkChatMessageLike;
        }
      }
      const it = run();
      return Object.assign(it, {
        interrupt: async () => undefined,
        setModel: async () => undefined,
        close: () => void it.return(undefined),
      });
    };
    const p = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      chatQuery,
      binaryPath: "/bin/claude",
    });
    const chat = p.openChat({ ...BASE, resume: "sdk-old" });
    chat.send("o que está fraco?");
    const events = await take(chat.events, (e) => e.type === "turn_end");
    chat.close();
    expect(events.map((e) => e.type)).toEqual(["init", "turn_end"]);
    expect(captured.inputs).toEqual(["o que está fraco?"]);
    expect(captured.options).toMatchObject({
      model: "sonnet",
      systemPrompt: { type: "custom", prompt: "persona + cartão", snapshot: false },
      resume: "sdk-old",
      maxTurns: 8,
      includePartialMessages: true,
      tools: ["WebSearch", "WebFetch"],
      // sem permissão explícita o CLI nega as tools no modo não interativo (dono, 2026-10-12: ingest_status negada);
      // WebFetch fica de fora: quem decide é o canUseTool, pela lista de domínios confiáveis (auditoria A)
      allowedTools: ["mcp__narnia-jobs", "WebSearch"],
      // texto do usuário literal: sem slash commands nem expansão de @arquivo (auditoria A)
      verbatimPrompts: true,
      plugins: [{ type: "local", path: "/app/plugin", skipMcpDiscovery: true }],
      mcpServers: {
        "narnia-jobs": {
          type: "http",
          url: BASE.mcp.url,
          headers: BASE.mcp.headers,
          alwaysLoad: true,
        },
      },
      settingSources: [],
      pathToClaudeCodeExecutable: "/bin/claude",
    });
    const env = (captured.options?.env ?? {}) as Record<string, string>;
    expect(env.NARNIA_SESSION_HAS_CARD).toBe("1");
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("canUseTool: WebFetch só para domínio confiável; o resto é negado com orientação em pt-BR (auditoria A)", async () => {
    let options: Record<string, unknown> = {};
    const chatQuery: ChatQueryFn = ({ options: o }) => {
      options = o as unknown as Record<string, unknown>;
      async function* run() {}
      const it = run();
      return Object.assign(it, {
        interrupt: async () => undefined,
        setModel: async () => undefined,
        close: () => void it.return(undefined),
      });
    };
    const p = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      chatQuery,
      binaryPath: "/bin/claude",
    });
    const fetched: string[] = [];
    const chat = p.openChat({
      ...BASE,
      canFetch: (url) => {
        fetched.push(url);
        return url.startsWith("https://ibge.gov.br/");
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    const can = options.canUseTool as (
      tool: string,
      input: Record<string, unknown>,
      o: { signal: AbortSignal },
    ) => Promise<{ behavior: string; message?: string }>;
    const signal = new AbortController().signal;
    expect(
      await can("WebFetch", { url: "https://ibge.gov.br/x", prompt: "p" }, { signal }),
    ).toMatchObject({
      behavior: "allow",
    });
    const denied = await can(
      "WebFetch",
      { url: "https://atacante.com/?d=1", prompt: "p" },
      { signal },
    );
    expect(denied.behavior).toBe("deny");
    expect(denied.message).toMatch(/Configurações › Chat/);
    expect((await can("WebFetch", { prompt: "sem url" }, { signal })).behavior).toBe("deny");
    expect((await can("Bash", { command: "ls" }, { signal })).behavior).toBe("deny");
    expect(fetched).toEqual(["https://ibge.gov.br/x", "https://atacante.com/?d=1"]);
    chat.close();
  });

  it("sem canFetch, WebFetch é sempre negado", async () => {
    let options: Record<string, unknown> = {};
    const chatQuery: ChatQueryFn = ({ options: o }) => {
      options = o as unknown as Record<string, unknown>;
      async function* run() {}
      const it = run();
      return Object.assign(it, {
        interrupt: async () => undefined,
        setModel: async () => undefined,
        close: () => void it.return(undefined),
      });
    };
    const p = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      chatQuery,
      binaryPath: "/bin/claude",
    });
    p.openChat(BASE).close();
    await new Promise((r) => setTimeout(r, 0));
    const can = options.canUseTool as (
      tool: string,
      input: Record<string, unknown>,
      o: { signal: AbortSignal },
    ) => Promise<{ behavior: string }>;
    expect(
      (
        await can(
          "WebFetch",
          { url: "https://ibge.gov.br/" },
          { signal: new AbortController().signal },
        )
      ).behavior,
    ).toBe("deny");
  });

  it("falha ao abrir o processo vira evento error, sem lançar", async () => {
    const chatQuery: ChatQueryFn = () => {
      throw new Error("spawn claude ENOENT");
    };
    const p = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      chatQuery,
    });
    const chat = p.openChat(BASE);
    const events = await take(chat.events, (e) => e.type === "error");
    expect(events[0]).toMatchObject({ type: "error", message: expect.stringContaining("ENOENT") });
  });
});

describe("MockProvider.openChat (roteiros que chamam o /mcp real)", () => {
  function fakeMcp() {
    const calls: Array<{ name: string; args: Record<string, unknown>; headers: Headers }> = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method: string;
        params: { name: string; arguments: Record<string, unknown> };
      };
      calls.push({
        name: body.params.name,
        args: body.params.arguments,
        headers: new Headers(init?.headers),
      });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [{ type: "text", text: '{"items":[{"id":"e1","line":"Acme · Dev"}]}' }],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    return { calls, fetchFn };
  }

  it("carreira: chama evidence_experience_list no /mcp com os headers da sessão, responde em deltas e fecha o turno com uso", async () => {
    const mcp = fakeMcp();
    const p = new MockProvider();
    const chat = p.openChat({ ...BASE, fetch: mcp.fetchFn });
    chat.send("o que está fraco no meu perfil?");
    const events = await take(chat.events, (e) => e.type === "turn_end");
    chat.close();
    expect(events[0]).toMatchObject({ type: "init" });
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({
      name: "evidence_experience_list",
    });
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({
      isError: false,
      output: '{"items":[{"id":"e1","line":"Acme · Dev"}]}',
    });
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ input: "{}" });
    expect(events.filter((e) => e.type === "llm_message").length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(1);
    const end = events.at(-1);
    expect(end?.type === "turn_end" && end.usage.inputTokens).toBeGreaterThan(0);
    expect(mcp.calls[0]?.name).toBe("evidence_experience_list");
    expect(mcp.calls[0]?.headers.get("x-narnia-session")).toBe("s1");
  });

  it("pesquisa, ingestão pela conversa e clarificação escolhem a tool certa", async () => {
    const cases: Array<[Partial<ChatOpenOptions>, string, string]> = [
      [{}, "qual o salário de mercado para backend?", "research_save"],
      [{}, "texto: trabalhei 3 anos na Acme liderando squads", "ingest_text"],
      [{ category: "clarify", ingestionRunId: "run-1" }, "pode perguntar", "ingest_propose"],
    ];
    for (const [extra, text, tool] of cases) {
      const mcp = fakeMcp();
      const chat = new MockProvider().openChat({ ...BASE, ...extra, fetch: mcp.fetchFn });
      chat.send(text);
      await take(chat.events, (e) => e.type === "turn_end");
      chat.close();
      expect(mcp.calls[0]?.name).toBe(tool);
      if (tool === "ingest_propose") expect(mcp.calls[0]?.args.runId).toBe("run-1");
    }
  });

  it("resume mantém o id da sessão do provider; erro configurado vira evento error", async () => {
    const mcp = fakeMcp();
    const resumed = new MockProvider().openChat({
      ...BASE,
      resume: "mock-abc",
      fetch: mcp.fetchFn,
    });
    resumed.send("oi");
    const ev = await take(resumed.events, (e) => e.type === "turn_end");
    resumed.close();
    expect(ev[0]).toEqual({ type: "init", providerSessionId: "mock-abc" });

    const broken = new MockProvider({
      errors: { openChat: "Claude Code process exited with code 1" },
    }).openChat({
      ...BASE,
      fetch: mcp.fetchFn,
    });
    broken.send("oi");
    const err = await take(broken.events, (e) => e.type === "error");
    broken.close();
    expect(err.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("code 1") });
  });
});
