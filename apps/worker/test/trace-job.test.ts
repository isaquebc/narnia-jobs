import { setTracer, startSpan, type TracerImpl } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { traceJob } from "../src/trace-job";

/** Cada job do worker vira um span CHAIN; as chamadas ao modelo dentro dele entram no mesmo rastro. */
function fakeTracer() {
  const spans: Array<{ name: string; attrs: Record<string, unknown>; error?: string }> = [];
  let inside: string | null = null;
  const impl: TracerImpl = {
    startSpan(name, attrs = {}) {
      const s: (typeof spans)[number] = { name, attrs: { ...attrs, parent: inside ?? "" } };
      spans.push(s);
      return {
        spanId: name,
        setAttributes: (a) => Object.assign(s.attrs, a),
        recordError: (e) => {
          s.error = (e as Error).message;
        },
        end: () => undefined,
      };
    },
    runInSpan(span, fn) {
      inside = span.spanId ?? null;
      try {
        return fn();
      } finally {
        inside = null;
      }
    },
  };
  return { spans, impl };
}

describe("traceJob", () => {
  afterEach(() => setTracer(null));

  it("etapa de ingestão: CHAIN com execução como sessão, dados do job e saída; filhos dentro dele", async () => {
    const f = fakeTracer();
    setTracer(f.impl);
    const out = await traceJob(
      { runId: "run-1", stage: "extract.facts" },
      { jobId: "j1", queue: "extract" },
      async () => {
        startSpan("llm.structured");
        return { proposals: 3 };
      },
    );
    expect(out).toEqual({ proposals: 3 });
    expect(f.spans[0]).toMatchObject({
      name: "job.extract.facts",
      attrs: {
        "openinference.span.kind": "CHAIN",
        "session.id": "run-1",
        "narnia.run_id": "run-1",
        "narnia.job_id": "j1",
        "narnia.queue": "extract",
        "input.value": '{"runId":"run-1","stage":"extract.facts"}',
        "output.value": '{"proposals":3}',
      },
    });
    expect(f.spans[1]).toMatchObject({
      name: "llm.structured",
      attrs: { parent: "job.extract.facts" },
    });
  });

  it("tarefa: nome pelo tipo; erro marca o span e segue lançado", async () => {
    const f = fakeTracer();
    setTracer(f.impl);
    await expect(
      traceJob(
        { kind: "task", type: "profile.analyze", key: "k", payload: {} },
        { jobId: "j2", queue: "tasks" },
        async () => {
          throw new Error("quebrou");
        },
      ),
    ).rejects.toThrow("quebrou");
    expect(f.spans[0]).toMatchObject({ name: "job.profile.analyze", error: "quebrou" });
    expect(f.spans[0]?.attrs).not.toHaveProperty("session.id");
  });
});
