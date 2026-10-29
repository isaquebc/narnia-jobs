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
  /** Todos os fatos do usuário (`knownFactsText`): datas e empresas que o recrutador leu pelas tools não são inventadas. */
  knownFacts?: string;
  /** F12/M5: cria um formulário novo no sandbox para cada caso aberto pela conversa do formulário. */
  newApplication?: (o?: { withPosting?: boolean }) => string;
  /** Antes de cada caso de feedback do documento: o CV da vaga volta à versão pronta (amostras repetidas). */
  readyPostingCv?: () => void;
  /** F07/M6: a candidatura do sandbox, para os casos abertos pela conversa da candidatura. */
  jobApplication?: () => string;
  /** Vagas salvas (empresa e cargo, uma por linha): citar a empresa da vaga não é inventar (F12/M5). */
  savedPostings?: string;
  /**
   * Erro do turno que a sessão registrou (o `chat.error` do sandbox): o limite de uso vira erro na hora, sem esperar o
   * tempo do turno (retomada do gate, 2026-10-28).
   */
  turnError?: (sessionId: string) => string | undefined;
  /** Gate: o primeiro erro para a rodada (`EvalRunAborted`); rodada com erro não grava nada mesmo. */
  stopOnError?: boolean;
  /** Cada caso, assim que termina (com ou sem erro): o gate guarda as conversas terminadas para retomar. */
  onCase?: (report: EvalCaseReport) => void;
}

/** A rodada parou no primeiro erro (`stopOnError`). */
export class EvalRunAborted extends Error {
  constructor(
    readonly caseId: string,
    readonly reason: string,
  ) {
    super(`${caseId}: ${reason}`);
    this.name = "EvalRunAborted";
  }
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
  /** System prompt do recrutador na rodada (persona e cartões): o juiz o recebe como contexto. */
  context?: string;
  /** Juízes com modelo (padrão de entrega), preenchidos pelo comando de avaliações. */
  judges?: Array<{ name: string; label: string; score: number; explanation: string }>;
  /** Medidas da conversa para o relatório da rodada (F04-fix-fundamentacao, R0). */
  metrics?: CaseMetrics;
  error?: string;
}

/** Por turno (uma resposta do recrutador) e da conversa inteira. */
export interface CaseMetrics {
  /** Do envio da mensagem até a resposta aparecer (ms). */
  turnMs: number[];
  /** Tools do recrutador por turno (sem as do subagente). */
  toolsPerTurn: number[];
  /** Chamadas à `fact_search` por turno (do recrutador e do subagente). */
  searchesPerTurn: number[];
  replyChars: number[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
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
  toolCalls: Array<{ name: string; subagent?: boolean }>;
}

/**
 * Contexto do juiz do recrutador. O juiz não vê o que as ferramentas devolveram, só o nome delas: sem os fatos
 * registrados, o que veio de uma tool (uma conquista fora do cartão) parecia invenção (falso negativo) e uma empresa
 * inventada passava (falso positivo). Calibração em `evals/calibration`, 2026-10-24.
 */
export function judgeContext(persona: string, knownFacts: string, savedPostings = ""): string {
  const block = (tag: string, text: string) =>
    text.trim() ? `\n\n<${tag}>\n${text.trim()}\n</${tag}>` : "";
  return `${persona}${block("fatos_registrados", knownFacts)}${block("vagas_salvas", savedPostings)}`;
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
  // o que o recrutador recebe no system prompt (persona e cartões de todos os perfis)
  const persona = await call<{ text: string }>("/api/profiles/active/persona-card")
    .then((c) => c.text)
    .catch(() => "");
  const card = [persona, o.knownFacts ?? "", o.savedPostings ?? ""].join("\n");
  // contexto do juiz: os cartões e os fatos que as ferramentas podem devolver (calibração, 2026-10-24)
  const context = judgeContext(persona, o.knownFacts ?? "", o.savedPostings ?? "");
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
    const turnMs: number[] = [];
    // tempo de um turno: do envio até a resposta aparecer
    const timed = async (run: () => Promise<unknown>) => {
      const t0 = Date.now();
      await run();
      turnMs.push(Date.now() - t0);
    };
    try {
      let first = 0;
      if (c.open === "application_chat" || c.open === "application_chat_no_posting") {
        // F12/M5: conversa do formulário pela janela da extensão, num formulário novo da vaga do sandbox
        if (!o.newApplication) throw new Error("sandbox sem formulário para a conversa");
        const appId = o.newApplication({ withPosting: c.open === "application_chat" });
        await timed(async () => {
          sessionId = (
            await call<{ session: { id: string } }>(`/api/applications/${appId}/chat`, {
              method: "POST",
              body: JSON.stringify({ message: c.messages[0] }),
            })
          ).session.id;
          await waitReplies(call, sessionId, 1, o.turnTimeoutMs ?? 180_000, o.turnError);
        });
        first = 1;
      } else if (c.open === "job_application_chat") {
        // F07/M6: "Conversar sobre esta candidatura" na página da candidatura
        if (!o.jobApplication) throw new Error("sandbox sem candidatura para a conversa");
        const jobAppId = o.jobApplication();
        await timed(async () => {
          sessionId = (
            await call<{ session: { id: string } }>(`/api/job-applications/${jobAppId}/chat`, {
              method: "POST",
              body: JSON.stringify({ message: c.messages[0] }),
            })
          ).session.id;
          await waitReplies(call, sessionId, 1, o.turnTimeoutMs ?? 180_000, o.turnError);
        });
        first = 1;
      } else if (c.open === "document_feedback") {
        o.readyPostingCv?.();
        // "Regerar com mensagem": o CV pronto da vaga do sandbox (um caso anterior pode ter deixado outro CV em
        // geração), com a primeira mensagem como feedback
        const { documents } = await call<{
          documents: Array<{
            document: { id: string; postingId: string | null };
            current: { status: string } | null;
          }>;
        }>("/api/documents?kind=cv");
        const cv = documents.find((d) => d.document.postingId && d.current?.status === "ready");
        if (!cv) throw new Error("sandbox sem CV para o feedback");
        await timed(async () => {
          sessionId = (
            await call<{ session: { id: string } }>(`/api/documents/${cv.document.id}/feedback`, {
              method: "POST",
              body: JSON.stringify({ message: c.messages[0] }),
            })
          ).session.id;
          await waitReplies(call, sessionId, 1, o.turnTimeoutMs ?? 180_000, o.turnError);
        });
        first = 1;
      } else
        sessionId = (
          await call<{ session: { id: string } }>("/api/sessions", {
            method: "POST",
            body: JSON.stringify({ category: c.category, title: `eval: ${c.id}` }),
          })
        ).session.id;
      for (const [i, text] of c.messages.entries()) {
        if (i < first) continue;
        await timed(async () => {
          await call(`/api/sessions/${sessionId}/messages`, {
            method: "POST",
            body: JSON.stringify({ text }),
          });
          await waitReplies(call, sessionId, i + 1, o.turnTimeoutMs ?? 180_000, o.turnError);
        });
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
          // o teto de turnos é do recrutador da conversa: as tools do especializado (F06-8) rodam no turno dele
          toolsPerReply: assistant.map((m) => m.toolCalls.filter((t) => !t.subagent).length),
          toolsByReply: assistant.map((m) => m.toolCalls.map((t) => t.name)),
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
        context,
        metrics: {
          turnMs,
          toolsPerTurn: assistant.map((m) => m.toolCalls.filter((t) => !t.subagent).length),
          searchesPerTurn: assistant.map(
            (m) => m.toolCalls.filter((t) => t.name === "fact_search").length,
          ),
          replyChars: assistant.map((m) => m.contentMd.length),
          tokensIn: session.tokensIn,
          tokensOut: session.tokensOut,
          costUsd: session.costUsdEst,
        },
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
    const last = out[out.length - 1];
    if (last) o.onCase?.(last);
    if (o.stopOnError && last?.error) throw new EvalRunAborted(last.id, last.error);
  }
  return out;
}

async function waitReplies(
  call: <T>(path: string) => Promise<T>,
  sessionId: string,
  count: number,
  timeoutMs: number,
  turnError?: (sessionId: string) => string | undefined,
): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const failed = turnError?.(sessionId);
    if (failed) throw new Error(`o turno da conversa ${sessionId} falhou: ${failed}`);
    const { messages } = await call<{ messages: Message[] }>(
      `/api/sessions/${sessionId}/messages?limit=200`,
    );
    if (messages.filter((m) => m.role === "assistant").length >= count) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`a conversa ${sessionId} não respondeu em ${timeoutMs} ms`);
}
