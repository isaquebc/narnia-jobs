import { type EvalCase, type GradeResult, gradeTranscript } from "@narnia-jobs/core";
import { annotateSpan, clip, contentTracingEnabled, startSpan } from "@narnia-jobs/shared";

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
  /** Início e fim do caso (ISO), para a execução do experimento no Phoenix. */
  startedAt: string;
  endedAt: string;
  /** Respostas do recrutador (só vão para o Phoenix com NARNIA_OTEL_CONTENT=1). */
  replies: string[];
  /** Ferramentas chamadas na conversa (nome publicado). */
  tools: string[];
  /** Juízes com modelo (padrão de entrega), preenchidos pelo comando de avaliações. */
  judges?: Array<{ name: string; label: string; score: number; explanation: string }>;
  error?: string;
}

interface SessionView {
  profileId: string;
  tokensIn: number;
  tokensOut: number;
  costUsdEst: number;
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
  // tetos e domínios confiáveis valem para a rodada inteira (auditoria E2, 19b)
  const settings = await call<{ settings: { maxBudgetUsd: number | null; maxTurns: number } }>(
    "/api/settings/chat",
  )
    .then((r) => r.settings)
    .catch(() => null);
  const trustedDomains = await call<{ domains: Array<{ pattern: string; enabled: boolean }> }>(
    "/api/settings/trusted-domains",
  )
    .then((r) => r.domains.filter((d) => d.enabled).map((d) => d.pattern))
    .catch(() => []);
  const out: EvalCaseReport[] = [];
  for (const c of cases) {
    const startedAt = new Date().toISOString();
    let replies: string[] = [];
    let tools: string[] = [];
    const content = contentTracingEnabled();
    const span = startSpan("eval.case", {
      "openinference.span.kind": "CHAIN",
      "narnia.eval.case": c.id,
      "narnia.category": c.category,
      ...(c.description ? { "narnia.eval.description": c.description } : {}),
      ...(content
        ? { "input.value": clip(c.messages.join("\n\n")), "input.mime_type": "text/plain" }
        : {}),
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
      const assistant = messages.filter((m) => m.role === "assistant");
      replies = assistant.map((m) => m.contentMd);
      tools = messages.flatMap((m) => m.toolCalls.map((t) => t.name));
      const { session } = await call<{ session: SessionView }>(`/api/sessions/${sessionId}`);
      const { sources } = await call<{
        sources: Array<{ url: string; sessionId: string | null; userConfirmed?: boolean }>;
      }>(`/api/research?profile=${encodeURIComponent(session.profileId)}`);
      const results = gradeTranscript(
        {
          replies,
          tools,
          card,
          userText: c.messages,
          sources: sources
            .filter((s) => s.sessionId === sessionId)
            .map((s) => ({ url: s.url, userConfirmed: s.userConfirmed === true })),
          trustedDomains,
          usage: { tokens: session.tokensIn + session.tokensOut, costUsd: session.costUsdEst },
          budgetUsd: settings?.maxBudgetUsd ?? null,
          ...(settings ? { maxTurns: settings.maxTurns } : {}),
          toolsPerReply: assistant.map((m) => m.toolCalls.length),
        },
        c.graders,
      );
      const passed = results.every((r) => r.passed);
      span.setAttributes({
        "narnia.eval.passed": passed,
        "narnia.session_id": sessionId,
        "session.id": sessionId,
        "narnia.eval.results": JSON.stringify(results.map((r) => ({ [r.type]: r.passed }))),
        ...(content
          ? {
              "output.value": clip(replies.join("\n\n---\n\n")),
              "output.mime_type": "text/plain",
            }
          : {}),
      });
      // no Phoenix: uma anotação por avaliador (e o resultado do caso) e uma nota com o resumo
      annotateSpan(
        span,
        [
          {
            name: "passed",
            label: passed ? "passou" : "falhou",
            score: passed ? 1 : 0,
            explanation: `${results.filter((r) => r.passed).length}/${results.length} avaliadores`,
          },
          ...results.map((r) => ({
            name: r.type,
            label: r.passed ? "passou" : "falhou",
            score: r.passed ? 1 : 0,
            explanation: r.detail,
          })),
        ],
        [
          `${c.id}${c.description ? `: ${c.description}` : ""}`,
          `Tools: ${[...new Set(tools)].join(", ") || "nenhuma"}`,
          ...results.map((r) => `${r.passed ? "✔" : "✘"} ${r.type}: ${r.detail}`),
        ].join("\n"),
      );
      out.push({
        id: c.id,
        passed,
        results,
        sessionId,
        startedAt,
        endedAt: new Date().toISOString(),
        replies,
        tools,
      });
    } catch (e) {
      span.recordError(e);
      span.setAttributes({ "narnia.eval.passed": false });
      out.push({
        id: c.id,
        passed: false,
        results: [],
        sessionId,
        startedAt,
        endedAt: new Date().toISOString(),
        replies,
        tools,
        error: (e as Error).message,
      });
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
