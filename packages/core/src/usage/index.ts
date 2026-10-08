import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { nowUtc, type UsageEvent, UsageEventSchema } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { newId } from "../ids";

/** Trecho relevante do `result` do Agent SDK (nomes em snake_case como a API devolve). */
export interface SdkUsageLike {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
}

export interface UsageMeta {
  category: string;
  model: string;
  jobId?: string | null;
  sessionId?: string | null;
}

export type UsageInput = Omit<UsageEvent, "id" | "ts"> & { id?: string; ts?: string };

export function usageFromSdkResult(result: SdkUsageLike, meta: UsageMeta): UsageInput {
  const u = result.usage ?? {};
  return {
    origin: "narnia",
    category: meta.category,
    model: meta.model,
    jobId: meta.jobId ?? null,
    sessionId: meta.sessionId ?? null,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    costUsdEst: result.total_cost_usd ?? 0,
  };
}

/** Grava `usage_event` e uma linha no JSONL do dia (UTC) em `<dataDir>/logs/usage-YYYY-MM-DD.jsonl` (03 §15, fonte 2). */
export function recordUsage(repos: Repos, dataDir: string, input: UsageInput): UsageEvent {
  const event = UsageEventSchema.parse({
    ...input,
    id: input.id ?? newId(),
    ts: input.ts ?? nowUtc(),
  });
  repos.usageEvents.insert(event);
  const day = event.ts.slice(0, 10);
  const dir = join(dataDir, "logs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `usage-${day}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
