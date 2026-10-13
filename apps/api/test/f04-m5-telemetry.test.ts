import { seedFixture } from "@narnia-jobs/core";
import { type AnyWsEvent, setTracer, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F04/M5 · rastros por turno de chat e por tool MCP, com conteúdo por padrão (Phoenix local). */
function fakeTracer() {
  const spans: Array<{
    id: string;
    name: string;
    attrs: Record<string, unknown>;
    parent: string | undefined;
    ended: boolean;
  }> = [];
  const annotations: Array<{ spanId: string | undefined; names: string[]; note?: string }> = [];
  const impl: TracerImpl = {
    startSpan(name, attrs = {}, opts) {
      const s = {
        id: `s${spans.length}`,
        name,
        attrs: { ...attrs },
        parent: opts?.parent?.spanId,
        ended: false,
      };
      spans.push(s);
      return {
        spanId: s.id,
        setAttributes: (a) => Object.assign(s.attrs, a),
        recordError: () => undefined,
        end: () => {
          s.ended = true;
        },
      };
    },
    annotate(span, list, note) {
      annotations.push({
        spanId: span.spanId,
        names: list.map((a) => a.name),
        ...(note ? { note } : {}),
      });
    },
  };
  return { spans, annotations, impl };
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

  it("um rastro por turno: turno → modelo → tool → /mcp, com entrada, saída e sessão; anotações e nota no turno", async () => {
    const f = fakeTracer();
    setTracer(f.impl);
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const sid = await turn(t);
    const chat = f.spans.find((s) => s.name === "chat.turn");
    expect(chat?.ended).toBe(true);
    expect(chat?.attrs).toMatchObject({
      "openinference.span.kind": "CHAIN",
      "session.id": sid,
      "narnia.session_id": sid,
      "narnia.category": "career",
      "input.value": "o que está fraco no meu perfil?",
    });
    expect(String(chat?.attrs["output.value"]).length).toBeGreaterThan(0);
    const llm = f.spans.filter((s) => s.name === "llm");
    expect(llm.length).toBe(2);
    expect(llm.every((s) => s.parent === chat?.id)).toBe(true);
    expect(String(llm[0]?.attrs["llm.input_messages.0.message.content"])).toContain("recrutador");
    const tool = f.spans.find((s) => s.name === "evidence_experience_list");
    expect(tool?.parent).toBe(chat?.id);
    expect(String(tool?.attrs["output.value"])).toContain("items");
    const mcp = f.spans.find((s) => s.name === "mcp.tool");
    expect(mcp?.parent).toBe(tool?.id);
    expect(mcp?.attrs).toMatchObject({
      "openinference.span.kind": "TOOL",
      "tool.name": "evidence.experience.list",
      "session.id": sid,
    });
    expect(String(mcp?.attrs["output.value"])).toContain("items");
    await new Promise((r) => setTimeout(r, 0));
    expect(f.annotations).toEqual([
      {
        spanId: chat?.id,
        names: [
          "no_unknown_years",
          "no_unknown_companies",
          "trusted_sources_only",
          "within_budget",
        ],
        note: expect.stringContaining("Tools: evidence_experience_list"),
      },
    ]);
  });

  it("com NARNIA_OTEL_CONTENT=0 só metadados: sem pergunta, resposta, argumentos nem resultados", async () => {
    process.env.NARNIA_OTEL_CONTENT = "0";
    const f = fakeTracer();
    setTracer(f.impl);
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    await turn(t);
    expect(f.spans.length).toBeGreaterThan(3);
    for (const s of f.spans)
      expect(Object.keys(s.attrs).filter((k) => /value|messages|parameters/.test(k))).toEqual([]);
  });
});
