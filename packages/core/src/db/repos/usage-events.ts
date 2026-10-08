import { type UsageEvent, UsageEventSchema } from "@narnia-jobs/shared";
import type { Db } from "../open";
import type { Row } from "../sql";

export interface UsageSummaryRow {
  category: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsdEst: number;
}

export interface UsageEventsRepo {
  insert(event: UsageEvent): void;
  summarizeByCategory(): UsageSummaryRow[];
  /** Tokens (entrada + saída) por modelo. */
  summarizeByModel(): Record<string, number>;
  /** Tokens (entrada + saída) totais. */
  totalTokens(): number;
  list(limit?: number): UsageEvent[];
}

export function usageEventsRepo(db: Db): UsageEventsRepo {
  const insert = db.prepare(
    `insert into usage_event (id, ts, origin, category, job_id, session_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd_est)
     values (@id, @ts, @origin, @category, @job_id, @session_id, @model, @input_tokens, @output_tokens, @cache_read, @cache_write, @cost_usd_est)`,
  );
  const summary = db.prepare(
    `select category, count(*) as events, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       sum(cache_read) as cache_read, sum(cache_write) as cache_write, sum(cost_usd_est) as cost
     from usage_event group by category order by category`,
  );
  const list = db.prepare("select * from usage_event order by ts desc, rowid desc limit ?");
  const byModel = db.prepare(
    "select model, sum(input_tokens + output_tokens) as tokens from usage_event group by model order by model",
  );
  const total = db.prepare(
    "select coalesce(sum(input_tokens + output_tokens), 0) as tokens from usage_event",
  );
  return {
    summarizeByModel() {
      return Object.fromEntries(
        (byModel.all() as Row[]).map((r) => [String(r.model), Number(r.tokens)]),
      );
    },
    totalTokens() {
      return Number((total.get() as { tokens: number }).tokens);
    },
    insert(event) {
      const e = UsageEventSchema.parse(event);
      insert.run({
        id: e.id,
        ts: e.ts,
        origin: e.origin,
        category: e.category,
        job_id: e.jobId,
        session_id: e.sessionId,
        model: e.model,
        input_tokens: e.inputTokens,
        output_tokens: e.outputTokens,
        cache_read: e.cacheRead,
        cache_write: e.cacheWrite,
        cost_usd_est: e.costUsdEst,
      });
    },
    summarizeByCategory() {
      return (summary.all() as Row[]).map((r) => ({
        category: String(r.category),
        events: Number(r.events),
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        cacheRead: Number(r.cache_read),
        cacheWrite: Number(r.cache_write),
        costUsdEst: Math.round(Number(r.cost) * 1e6) / 1e6,
      }));
    },
    list(limit = 100) {
      return (list.all(limit) as Row[]).map((r) =>
        UsageEventSchema.parse({
          id: r.id,
          ts: r.ts,
          origin: r.origin,
          category: r.category,
          jobId: r.job_id,
          sessionId: r.session_id,
          model: r.model,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          cacheRead: r.cache_read,
          cacheWrite: r.cache_write,
          costUsdEst: r.cost_usd_est,
        }),
      );
    },
  };
}
