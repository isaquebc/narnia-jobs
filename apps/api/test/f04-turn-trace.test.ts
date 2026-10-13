import type { ChatEvent, Usage } from "@narnia-jobs/providers";
import { type SpanHandle, setTracer, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { TurnTrace } from "../src/chat/turn-trace";

/** Rastro do turno no Phoenix: turno → chamadas ao modelo e tools como filhos, com entrada e saída. */
interface FakeSpan {
  name: string;
  attrs: Record<string, unknown>;
  parent: string | undefined;
  start: number | undefined;
  end: number | undefined;
  ended: boolean;
  error?: string;
  id: string;
}

function fakeTracer() {
  const spans: FakeSpan[] = [];
  const impl: TracerImpl = {
    startSpan(name, attrs = {}, opts) {
      const s: FakeSpan = {
        name,
        attrs: { ...attrs },
        parent: opts?.parent?.spanId,
        start: opts?.startTime,
        end: undefined,
        ended: false,
        id: `s${spans.length}`,
      };
      spans.push(s);
      const h: SpanHandle = {
        spanId: s.id,
        setAttributes: (a) => Object.assign(s.attrs, a),
        recordError: (e) => {
          s.error = (e as Error).message;
        },
        end: (t) => {
          s.ended = true;
          s.end = t;
        },
      };
      return h;
    },
  };
  return { spans, impl };
}

const usage = (i: number, o: number, model = "claude-sonnet-4-5"): Usage => ({
  inputTokens: i,
  outputTokens: o,
  cacheReadTokens: 100,
  cacheWriteTokens: 0,
  model,
});

const init = {
  sessionId: "sess-1",
  profileId: "prof-1",
  category: "career",
  turnIndex: 2,
  model: "sonnet",
  systemPrompt: "Você é o recrutador.",
  userText: "o que está fraco?",
  sentText: "[nota] cartão\n\no que está fraco?",
};

describe("TurnTrace", () => {
  afterEach(() => {
    setTracer(null);
    delete process.env.NARNIA_OTEL_CONTENT;
  });

  it("turno com tool: CHAIN raiz, LLM → TOOL → LLM como filhos, com mensagens, tokens e resultado da tool", () => {
    const f = fakeTracer();
    setTracer(f.impl);
    const t = new TurnTrace(init);
    const events: ChatEvent[] = [
      { type: "llm_message", messageId: "m1", model: "claude-sonnet-4-5", usage: usage(1000, 30) },
      { type: "text_break" },
      { type: "delta", text: "Vou olhar suas experiências." },
      {
        type: "tool_start",
        id: "tu1",
        name: "evidence_experience_list",
        args: '{"limit":5}',
        input: '{"limit":5}',
      },
      { type: "tool_end", id: "tu1", isError: false, output: '{"items":[]}' },
      { type: "llm_message", messageId: "m2", model: "claude-sonnet-4-5", usage: usage(1200, 60) },
      { type: "text_break" },
      { type: "delta", text: "Faltam métricas." },
    ];
    for (const e of events) t.onEvent(e);
    const root = t.finish({
      text: "Vou olhar suas experiências.\n\nFaltam métricas.",
      usage: usage(2200, 90),
      costUsd: 0.02,
    });
    expect(root.spanId).toBe("s0");
    const [chain, llm1, tool, llm2] = f.spans;
    expect(f.spans.map((s) => [s.name, s.parent])).toEqual([
      ["chat.turn", undefined],
      ["llm", "s0"],
      ["evidence_experience_list", "s0"],
      ["llm", "s0"],
    ]);
    expect(f.spans.every((s) => s.ended)).toBe(true);
    expect(chain?.attrs).toMatchObject({
      "openinference.span.kind": "CHAIN",
      "session.id": "sess-1",
      "user.id": "prof-1",
      "tag.tags": ["career"],
      "input.value": "o que está fraco?",
      "input.mime_type": "text/plain",
      "output.value": "Vou olhar suas experiências.\n\nFaltam métricas.",
      "llm.token_count.prompt": 2300,
      "llm.token_count.completion": 90,
      "llm.token_count.total": 2390,
      "narnia.cost_usd": 0.02,
      "narnia.tool_calls": 1,
    });
    expect(JSON.parse(String(chain?.attrs.metadata))).toMatchObject({
      category: "career",
      turnIndex: 2,
    });
    expect(llm1?.attrs).toMatchObject({
      "openinference.span.kind": "LLM",
      "llm.provider": "anthropic",
      "llm.model_name": "claude-sonnet-4-5",
      "llm.input_messages.0.message.role": "system",
      "llm.input_messages.0.message.content": "Você é o recrutador.",
      "llm.input_messages.1.message.role": "user",
      "llm.input_messages.1.message.content": "[nota] cartão\n\no que está fraco?",
      "llm.output_messages.0.message.role": "assistant",
      "llm.output_messages.0.message.content": "Vou olhar suas experiências.",
      "llm.output_messages.0.message.tool_calls.0.tool_call.function.name":
        "evidence_experience_list",
      "llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments": '{"limit":5}',
      "llm.token_count.prompt": 1100,
      "llm.token_count.prompt_details.cache_read": 100,
      "llm.token_count.completion": 30,
      "output.value": "Vou olhar suas experiências.",
    });
    expect(tool?.attrs).toMatchObject({
      "openinference.span.kind": "TOOL",
      "tool.name": "evidence_experience_list",
      "input.value": '{"limit":5}',
      "input.mime_type": "application/json",
      "output.value": '{"items":[]}',
    });
    // a 2ª chamada ao modelo recebe o resultado da tool e começa quando a tool termina
    expect(llm2?.attrs).toMatchObject({
      "llm.input_messages.0.message.role": "tool",
      "llm.input_messages.0.message.content": '{"items":[]}',
      "llm.input_messages.0.message.tool_call_id": "tu1",
      "llm.output_messages.0.message.content": "Faltam métricas.",
    });
    expect(llm2?.start).toBe(tool?.end ?? Number.NaN);
    expect(llm1?.end).toBeLessThanOrEqual(tool?.end ?? 0);
  });

  it("tool com erro marca o span da tool; toolSpan acha a tool aberta pelo nome (pai do span do /mcp)", () => {
    const f = fakeTracer();
    setTracer(f.impl);
    const t = new TurnTrace(init);
    t.onEvent({ type: "tool_start", id: "a", name: "research_apply", args: "{}", input: "{}" });
    expect(t.toolSpan("research_apply")?.spanId).toBe("s2");
    expect(t.toolSpan("fact_search")).toBeUndefined();
    t.onEvent({ type: "tool_end", id: "a", isError: true, output: "[not_pending] não" });
    expect(t.toolSpan("research_apply")).toBeUndefined();
    t.finish({ text: "", usage: usage(1, 1), costUsd: 0 });
    const tool = f.spans.find((s) => s.name === "research_apply");
    expect(tool?.error).toBe("[not_pending] não");
  });

  it("interrompido e erro: o turno fecha com a marca e as filhas abertas fecham junto", () => {
    const f = fakeTracer();
    setTracer(f.impl);
    const t = new TurnTrace(init);
    t.onEvent({ type: "delta", text: "parcial" });
    t.onEvent({ type: "tool_start", id: "a", name: "fact_search", args: "{}", input: "{}" });
    t.finish({ text: "parcial", interrupted: true });
    expect(f.spans.every((s) => s.ended)).toBe(true);
    expect(f.spans[0]?.attrs["narnia.interrupted"]).toBe(true);
    const t2 = new TurnTrace(init);
    t2.finish({ text: "", error: "Falha da API" });
    expect(f.spans.at(-1)?.error).toBe("Falha da API");
  });

  it("com NARNIA_OTEL_CONTENT=0 só metadados: sem mensagens, entradas nem saídas", () => {
    process.env.NARNIA_OTEL_CONTENT = "0";
    const f = fakeTracer();
    setTracer(f.impl);
    const t = new TurnTrace(init);
    t.onEvent({ type: "delta", text: "x" });
    t.onEvent({ type: "tool_start", id: "a", name: "fact_search", args: "{}", input: "{}" });
    t.onEvent({ type: "tool_end", id: "a", isError: false, output: "[]" });
    t.finish({ text: "x", usage: usage(1, 1), costUsd: 0 });
    for (const s of f.spans)
      expect(Object.keys(s.attrs).filter((k) => /value|messages/.test(k))).toEqual([]);
  });
});
