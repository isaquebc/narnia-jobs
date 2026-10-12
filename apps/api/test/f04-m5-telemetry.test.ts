import { seedFixture } from "@narnia-jobs/core";
import { type AnyWsEvent, setTracer, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F04/M5 · rastros por turno de chat e por tool MCP; sem conteúdo de mensagem por padrão. */
function fakeTracer() {
  const spans: Array<{ name: string; attrs: Record<string, unknown>; ended: boolean }> = [];
  const impl: TracerImpl = {
    startSpan(name, attrs = {}) {
      const s = { name, attrs: { ...attrs }, ended: false };
      spans.push(s);
      return {
        setAttributes: (a) => Object.assign(s.attrs, a),
        recordError: () => undefined,
        end: () => {
          s.ended = true;
        },
      };
    },
  };
  return { spans, impl };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function turn(t: TestApp) {
  const r = await t.api("/api/sessions", json({}));
  const sid = ((await r.json()) as { session: { id: string } }).session.id;
  await t.api(`/api/sessions/${sid}/messages`, json({ text: "o que está fraco no meu perfil?" }));
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    if (t.events.some((e: AnyWsEvent) => e.type === "chat.turn_end" && e.sessionId === sid))
      return sid;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error("turno não terminou");
}

describe("F04/M5 · telemetria no api", () => {
  let t: TestApp | undefined;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
    setTracer(null);
    delete process.env.NARNIA_OTEL_CONTENT;
  });

  it("turno de chat e tool MCP viram spans com metadados, sem o texto das mensagens", async () => {
    const f = fakeTracer();
    setTracer(f.impl);
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const sid = await turn(t);
    const chat = f.spans.find((s) => s.name === "chat.turn");
    expect(chat?.ended).toBe(true);
    expect(chat?.attrs).toMatchObject({
      "openinference.span.kind": "CHAIN",
      "narnia.session_id": sid,
      "narnia.category": "career",
      "llm.model_name": "sonnet",
    });
    expect(chat?.attrs["llm.token_count.prompt"]).toEqual(expect.any(Number));
    expect(chat?.attrs).not.toHaveProperty("input.value");
    expect(chat?.attrs).not.toHaveProperty("output.value");
    const tool = f.spans.find((s) => s.name === "mcp.tool");
    expect(tool?.attrs).toMatchObject({
      "openinference.span.kind": "TOOL",
      "tool.name": "evidence.experience.list",
      "narnia.session_id": sid,
    });
    expect(tool?.attrs).not.toHaveProperty("input.value");
  });

  it("com NARNIA_OTEL_CONTENT=1 o turno leva pergunta e resposta", async () => {
    process.env.NARNIA_OTEL_CONTENT = "1";
    const f = fakeTracer();
    setTracer(f.impl);
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    await turn(t);
    const chat = f.spans.find((s) => s.name === "chat.turn");
    expect(String(chat?.attrs["input.value"])).toContain("o que está fraco");
    expect(String(chat?.attrs["output.value"]).length).toBeGreaterThan(0);
  });
});
