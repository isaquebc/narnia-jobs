import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedFixture } from "@narnia-jobs/core";
import {
  type ChatEvent,
  type ChatHandle,
  type ChatOpenOptions,
  createAsyncQueue,
  MockProvider,
} from "@narnia-jobs/providers";
import type { AnyWsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { toolErrorText } from "../src/mcp/server";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * Auditoria pós-F04 · bloco D (2026-10-12): o link "Abrir a ingestão criada" vem da própria tool de ingestão da
 * conversa (o `/mcp` sabe a sessão e o `runId`), fica gravado na tool call e sobrevive ao reload; erros de tool
 * passam pelo mapa de erros amigáveis.
 */

class ScriptedProvider extends MockProvider {
  queues: Array<{ opts: ChatOpenOptions; push: (e: ChatEvent) => void }> = [];
  override openChat(opts: ChatOpenOptions): ChatHandle {
    const q = createAsyncQueue<ChatEvent>();
    this.queues.push({ opts, push: (e) => q.push(e) });
    return {
      send: () => undefined,
      events: q.iterable,
      interrupt: async () => undefined,
      setModel: async () => undefined,
      close: () => undefined,
    };
  }
  push(e: ChatEvent) {
    this.queues.at(-1)?.push(e);
  }
}

async function connect(t: TestApp, sessionId: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: {
      headers: { authorization: `Bearer ${TOKEN}`, "x-narnia-session": sessionId },
    },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-audit-d", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(pred: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("condição não chegou");
    await tick();
  }
}

describe("auditoria D · ingestão criada pela conversa", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("ingest_text da conversa emite chat.ingestion_created e grava o runId na tool call (sobrevive ao reload)", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const ids = seedFixture(t.repos, "engineer");
    const s = t.sessions.create({ category: "career", profileId: ids.profileId });
    t.sessions.send(s.id, "registre isto");
    p.push({ type: "init", providerSessionId: "sdk-1" });
    p.push({ type: "tool_start", id: "t1", name: "ingest_text", args: "{}" });
    const client = await connect(t, s.id);
    const r = (await client.callTool({
      name: "ingest_text",
      arguments: {
        text: "Liderei a migração do sistema de pagamentos para Kotlin em 2023, com 4 pessoas no time. ".repeat(
          4,
        ),
      },
    })) as { isError?: boolean; content: Array<{ text?: string }> };
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    const runId = (JSON.parse(r.content[0]?.text ?? "{}") as { runId: string }).runId;
    expect(runId).toBeTruthy();
    const created = t.events.filter(
      (e: AnyWsEvent) => e.type === "chat.ingestion_created" && e.sessionId === s.id,
    );
    expect(created).toEqual([{ type: "chat.ingestion_created", sessionId: s.id, runId }]);

    p.push({ type: "tool_end", id: "t1", isError: false });
    p.push({
      type: "turn_end",
      text: "Registrei.",
      providerSessionId: "sdk-1",
      costUsd: 0,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "sonnet",
      },
    });
    await until(() => t.events.some((e) => e.type === "chat.turn_end"));
    const reply = t.repos.chatMessages.list(s.id).find((m) => m.role === "assistant");
    expect(reply?.toolCalls).toEqual([expect.objectContaining({ name: "ingest_text", runId })]);
    // pela rota (o que a web lê depois do reload)
    const res = await t.api(`/api/sessions/${s.id}/messages`);
    const body = (await res.json()) as {
      messages: Array<{ toolCalls: Array<{ runId?: string }> }>;
    };
    expect(body.messages.flatMap((m) => m.toolCalls.map((tc) => tc.runId))).toContain(runId);
  });

  it("tool que não cria ingestão não emite chat.ingestion_created nem grava runId", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const ids = seedFixture(t.repos, "engineer");
    const s = t.sessions.create({ category: "career", profileId: ids.profileId });
    const client = await connect(t, s.id);
    await client.callTool({ name: "fact_search", arguments: { query: "kotlin" } });
    expect(t.events.some((e) => e.type === "chat.ingestion_created")).toBe(false);
  });
});

describe("auditoria D · erro de tool pelo mapa de erros amigáveis", () => {
  it("erro interno conhecido vira texto em pt-BR com a chave e o detalhe técnico", () => {
    const out = toolErrorText(
      new Error("Failed to authenticate: OAuth session expired and could not be refreshed"),
    );
    expect(out).toMatch(/^\[auth_expired\] /);
    expect(out).toContain("O login da assinatura expirou");
    expect(out).toContain("Detalhe técnico: Failed to authenticate");
  });

  it("erro interno desconhecido mantém [internal] com texto pt-BR e o detalhe", () => {
    const out = toolErrorText(new Error("boom"));
    expect(out).toMatch(/^\[internal\] /);
    expect(out).toContain("Algo deu errado");
    expect(out).toContain("Detalhe técnico: boom");
  });

  it("erro tipado (código próprio, já em pt-BR) mantém o código para o modelo", () => {
    const e = Object.assign(new Error("Arquivo não encontrado: x"), { code: "file_not_found" });
    expect(toolErrorText(e)).toBe("[file_not_found] Arquivo não encontrado: x");
  });
});

describe("auditoria D · histórico paginado", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("before pagina para trás e since traz da âncora em diante (sem buraco depois de carregar as anteriores)", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const s = t.sessions.create({ category: "career", profileId: ids.profileId });
    const msgs = Array.from({ length: 6 }, (_, i) =>
      t.repos.chatMessages.add({
        sessionId: s.id,
        turnIndex: i,
        role: "user",
        contentMd: `m${i}`,
        toolCalls: [],
        usage: null,
      }),
    );
    const get = async (q: string) =>
      (
        (await (await t.api(`/api/sessions/${s.id}/messages?${q}`)).json()) as {
          messages: Array<{ contentMd: string }>;
        }
      ).messages.map((m) => m.contentMd);
    expect(await get("limit=2")).toEqual(["m4", "m5"]);
    expect(await get(`before=${msgs[4]?.id}&limit=2`)).toEqual(["m2", "m3"]);
    expect(await get(`since=${msgs[2]?.id}`)).toEqual(["m2", "m3", "m4", "m5"]);
  });
});
