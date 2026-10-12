import { type EvalCase, type GradeResult, gradeTranscript } from "@narnia-jobs/core";
import { startSpan } from "@narnia-jobs/shared";

/**
 * F04/M5 · runner das avaliações do chat (`evals/chat/*.jsonl`): conversa pela API da instância (a do Claude por
 * padrão), avalia com regras determinísticas e registra um span `eval.case` por caso (projeto `narnia-evals` do
 * Phoenix quando há `NARNIA_OTEL_ENDPOINT`). Com o mock é um smoke determinístico; com o provider real, a avaliação.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface EvalRunOptions {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
  turnTimeoutMs?: number;
}

export interface EvalCaseReport {
  id: string;
  passed: boolean;
  results: GradeResult[];
  sessionId: string;
  error?: string;
}

interface Message {
  role: string;
  contentMd: string;
  toolCalls: Array<{ name: string }>;
}

export async function runEvalCases(
  cases: EvalCase[],
  o: EvalRunOptions,
): Promise<EvalCaseReport[]> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${o.token}`);
    if (init.body) headers.set("content-type", "application/json");
    const r = await f(`${o.baseUrl}${path}`, { ...init, headers });
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const card = await call<{ text: string }>("/api/profiles/active/persona-card")
    .then((c) => c.text)
    .catch(() => "");
  const out: EvalCaseReport[] = [];
  for (const c of cases) {
    const span = startSpan("eval.case", {
      "narnia.eval.case": c.id,
      "narnia.category": c.category,
    });
    let sessionId = "";
    try {
      sessionId = (
        await call<{ session: { id: string } }>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ category: c.category, title: `eval: ${c.id}` }),
        })
      ).session.id;
      for (const [i, text] of c.messages.entries()) {
        await call(`/api/sessions/${sessionId}/messages`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
        await waitReplies(call, sessionId, i + 1, o.turnTimeoutMs ?? 180_000);
      }
      const { messages } = await call<{ messages: Message[] }>(
        `/api/sessions/${sessionId}/messages?limit=200`,
      );
      const replies = messages.filter((m) => m.role === "assistant").map((m) => m.contentMd);
      const tools = messages.flatMap((m) => m.toolCalls.map((t) => t.name));
      const results = gradeTranscript({ replies, tools, card }, c.graders);
      const passed = results.every((r) => r.passed);
      span.setAttributes({
        "narnia.eval.passed": passed,
        "narnia.session_id": sessionId,
        "narnia.eval.results": JSON.stringify(results.map((r) => ({ [r.type]: r.passed }))),
      });
      out.push({ id: c.id, passed, results, sessionId });
    } catch (e) {
      span.recordError(e);
      span.setAttributes({ "narnia.eval.passed": false });
      out.push({ id: c.id, passed: false, results: [], sessionId, error: (e as Error).message });
    } finally {
      span.end();
      // libera a vaga no teto de conversas (F04-3)
      if (sessionId)
        await call(`/api/sessions/${sessionId}/hibernate`, { method: "POST" }).catch(
          () => undefined,
        );
    }
  }
  return out;
}

async function waitReplies(
  call: <T>(path: string) => Promise<T>,
  sessionId: string,
  count: number,
  timeoutMs: number,
): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { messages } = await call<{ messages: Message[] }>(
      `/api/sessions/${sessionId}/messages?limit=200`,
    );
    if (messages.filter((m) => m.role === "assistant").length >= count) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`a conversa ${sessionId} não respondeu em ${timeoutMs} ms`);
}
