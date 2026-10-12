import { newId, type Repos } from "@narnia-jobs/core";
import { nowUtc } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import { PLUGIN_LAST_SEEN_KEY } from "./plugin-status";

export function usageSummary(repos: Repos) {
  const byCategory = Object.fromEntries(
    repos.usageEvents
      .summarizeByCategory()
      .map((r) => [r.category, r.inputTokens + r.outputTokens]),
  );
  return {
    totalTokens: repos.usageEvents.totalTokens(),
    byCategory,
    byModel: repos.usageEvents.summarizeByModel(),
  };
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MODEL = /^[A-Za-z0-9._:-]{1,100}$/;
const INT = /^\d{1,9}$/;
const MAX_LINES = 20_000;

interface TerminalUsageLine {
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Linha `msgId\tmodelo\tentrada\tsaída\tcache lido\tcache gravado` (hook Stop do plugin); null = malformada. */
function parseLine(line: string): TerminalUsageLine | null {
  const [messageId, model, ...nums] = line.split("\t");
  if (!messageId || !model || nums.length !== 4) return null;
  if (!MESSAGE_ID.test(messageId) || !MODEL.test(model) || !nums.every((n) => INT.test(n)))
    return null;
  const [inputTokens, outputTokens, cacheRead, cacheWrite] = nums.map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { messageId, model, inputTokens, outputTokens, cacheRead, cacheWrite };
}

export function usageRoutes(deps: { repos: Repos }) {
  const app = new Hono();
  app.get("/api/usage/summary", (c) => c.json(usageSummary(deps.repos)));
  /**
   * Uso do modo B (auditoria C, F04 §2.3): o hook `Stop` do plugin relê o transcript da sessão do Claude Code e manda
   * uma linha por mensagem do assistente. O transcript só cresce, então a posição da mensagem (na ordem da primeira
   * aparição) é estável e vira o `turn_index`: reenviar o transcript inteiro a cada resposta não conta nada duas vezes.
   */
  app.post("/api/usage/terminal", async (c) => {
    const session = c.req.query("session") ?? "";
    if (!SESSION_ID.test(session))
      return apiError(c, 400, "invalid_session", "Sessão do Claude Code inválida.");
    const raw = (await c.req.text()).split("\n").filter((l) => l.trim() !== "");
    if (raw.length > MAX_LINES)
      return apiError(c, 400, "too_many_lines", "Transcript grande demais para registrar.");
    const lines: TerminalUsageLine[] = [];
    for (const l of raw) {
      const parsed = parseLine(l.replace(/\r$/, ""));
      if (!parsed) return apiError(c, 400, "invalid_line", "Linha de uso malformada.");
      lines.push(parsed);
    }
    const order: string[] = [];
    const byId = new Map<string, TerminalUsageLine>();
    for (const l of lines) {
      if (!byId.has(l.messageId)) order.push(l.messageId);
      byId.set(l.messageId, l);
    }
    let recorded = 0;
    const ts = nowUtc();
    deps.repos.settings.set(PLUGIN_LAST_SEEN_KEY, ts); // sinal de plugin em uso (Configurações › Modo plugin)
    order.forEach((id, turnIndex) => {
      const l = byId.get(id) as TerminalUsageLine;
      const inserted = deps.repos.usageEvents.insertTurn(
        {
          id: newId(),
          ts,
          origin: "claude-log",
          category: "chat",
          jobId: null,
          sessionId: null,
          model: l.model,
          inputTokens: l.inputTokens,
          outputTokens: l.outputTokens,
          cacheRead: l.cacheRead,
          cacheWrite: l.cacheWrite,
          costUsdEst: 0,
        },
        { providerSessionId: `cli:${session}`, turnIndex },
      );
      if (inserted) recorded += 1;
    });
    return c.json({ recorded });
  });
  return app;
}
