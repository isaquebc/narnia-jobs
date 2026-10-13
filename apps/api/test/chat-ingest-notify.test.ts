import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CHAT_SETTING_KEYS, seedFixture } from "@narnia-jobs/core";
import {
  type ChatEvent,
  type ChatHandle,
  type ChatOpenOptions,
  createAsyncQueue,
  MockProvider,
} from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * Ingestão aberta pela conversa (pedido do dono, 2026-10-13): o recrutador não gasta tokens esperando. Quando o job
 * termina, o api chama o agente de novo, uma vez, com uma nota do sistema; o progresso vai para a tela pelo /ws.
 */
class ScriptedProvider extends MockProvider {
  sent: string[] = [];
  queues: Array<{ opts: ChatOpenOptions; push: (e: ChatEvent) => void }> = [];
  override openChat(opts: ChatOpenOptions): ChatHandle {
    const q = createAsyncQueue<ChatEvent>();
    this.queues.push({ opts, push: (e) => q.push(e) });
    return {
      send: (text) => {
        this.sent.push(text);
      },
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

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  model: "sonnet",
};
const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(pred: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("condição não chegou");
    await tick();
  }
}

async function connect(t: TestApp, sessionId: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: {
      headers: { authorization: `Bearer ${TOKEN}`, "x-narnia-session": sessionId },
    },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-aviso", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return client;
}

const STORY =
  "Na Acme, de 2022 até hoje, sou engenheira backend PJ com 30 horas semanais e recebo R$ 95 por hora. ".repeat(
    3,
  );

/** Conversa que abre uma ingestão pelo /mcp; devolve o runId. `finishTurn` fecha o turno da tool. */
async function openRunFromChat(t: TestApp, p: ScriptedProvider, finishTurn = true) {
  const ids = seedFixture(t.repos, "engineer");
  const s = t.sessions.create({ category: "career", profileId: ids.profileId });
  t.sessions.send(s.id, "registre isto");
  p.push({ type: "init", providerSessionId: "sdk-1" });
  p.push({ type: "tool_start", id: "t1", name: "ingest_text", args: "{}", input: "{}" });
  const client = await connect(t, s.id);
  const r = (await client.callTool({ name: "ingest_text", arguments: { text: STORY } })) as {
    content: Array<{ text?: string }>;
  };
  const runId = (JSON.parse(r.content[0]?.text ?? "{}") as { runId: string }).runId;
  p.push({ type: "tool_end", id: "t1", isError: false, output: "{}" });
  if (finishTurn) {
    p.push({
      type: "turn_end",
      text: "Abri a ingestão.",
      providerSessionId: "sdk-1",
      costUsd: 0,
      usage,
    });
    await until(() => t.events.some((e) => e.type === "chat.turn_end"));
  }
  return { sessionId: s.id, runId };
}

function finishRun(t: TestApp, runId: string, proposals = 2) {
  t.repos.proposals.insertMany(
    runId,
    Array.from({ length: proposals }, (_, i) => ({
      kind: "skill" as const,
      confidence: 0.9,
      data: { name: `Skill ${i}`, category: "language" as const },
    })),
  );
  t.repos.ingestionRuns.setStatus(runId, "review");
  t.bus.emit({ type: "ingestion.updated", runId, status: "review" });
}

describe("fim da ingestão aberta pela conversa", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("a execução fica ligada à conversa; ao ficar pronta, o agente é chamado uma vez com a nota do sistema", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const { sessionId, runId } = await openRunFromChat(t, p);
    expect(t.repos.ingestionRuns.get(runId)?.chatSessionId).toBe(sessionId);
    const before = p.sent.length;
    // andamento não chama o agente: só o fim
    t.bus.emit({ type: "ingestion.updated", runId, status: "running" });
    await tick();
    expect(p.sent.length).toBe(before);

    finishRun(t, runId);
    await until(() => p.sent.length === before + 1);
    const note = p.sent.at(-1) ?? "";
    expect(note).toContain("nota do sistema");
    expect(note).toContain(runId);
    expect(note).toContain("2 propostas");
    const shown = t.repos.chatMessages.list(sessionId).filter((m) => m.role === "system_note");
    expect(shown.map((m) => m.contentMd)).toEqual(["Ingestão pronta: 2 propostas para revisar"]);
    expect(t.repos.chatMessages.list(sessionId).some((m) => m.contentMd === note)).toBe(false);

    // o mesmo evento de novo (reload, outro relay) não chama de novo
    p.push({
      type: "turn_end",
      text: "Pronto, revise ao lado.",
      providerSessionId: "sdk-1",
      costUsd: 0,
      usage,
    });
    await until(() => t.events.filter((e) => e.type === "chat.turn_end").length === 2);
    t.bus.emit({ type: "ingestion.updated", runId, status: "review" });
    await tick();
    expect(p.sent.length).toBe(before + 1);
  });

  it("ingestão aberta no turno do aviso não fica ligada à conversa (sem laço de avisos)", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const { sessionId, runId } = await openRunFromChat(t, p);
    finishRun(t, runId);
    await until(() => p.sent.some((x) => x.includes("nota do sistema")));
    // o modelo desobedece e abre outra ingestão no turno do aviso
    p.push({ type: "tool_start", id: "t2", name: "ingest_text", args: "{}", input: "{}" });
    const client = await connect(t, sessionId);
    const r = (await client.callTool({
      name: "ingest_text",
      arguments: { text: `${STORY} outra` },
    })) as { content: Array<{ text?: string }> };
    const second = (JSON.parse(r.content[0]?.text ?? "{}") as { runId: string }).runId;
    expect(t.repos.ingestionRuns.get(second)?.chatSessionId).toBeNull();
  });

  it("job termina no meio de um turno: o aviso espera o turno acabar", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const { runId } = await openRunFromChat(t, p, false);
    const before = p.sent.length;
    finishRun(t, runId, 1);
    await tick();
    expect(p.sent.length).toBe(before);
    p.push({
      type: "turn_end",
      text: "Abri a ingestão.",
      providerSessionId: "sdk-1",
      costUsd: 0,
      usage,
    });
    await until(() => p.sent.length === before + 1);
    expect(p.sent.at(-1)).toContain("1 proposta");
  });

  it("teto de custo atingido: só a nota na conversa, sem chamar o agente", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const { sessionId, runId } = await openRunFromChat(t, p);
    t.repos.settings.set(CHAT_SETTING_KEYS.maxBudgetUsd, 1);
    t.repos.chatSessions.addUsage(sessionId, { inputTokens: 0, outputTokens: 0, costUsd: 2 });
    const before = p.sent.length;
    finishRun(t, runId);
    await until(() => t.repos.chatMessages.list(sessionId).some((m) => m.role === "system_note"));
    await tick();
    expect(p.sent.length).toBe(before);
  });
});
