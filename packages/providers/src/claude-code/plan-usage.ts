import type { PlanUsage, UsageWindow } from "@narnia-jobs/shared";

/**
 * Diagnóstico do plano (F03 §2.4, F03-3 §1). Duas fontes, nesta ordem:
 * 1. `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` do Agent SDK (estrutura do `/usage`): assinatura e
 *    janelas de 5 h, semanal e por modelo. Experimental: isolada aqui e tratada como opcional.
 * 2. O último `rate_limit_event` visto no stream de qualquer `query` (estável): uma janela por evento.
 * A Anthropic não publica o limite absoluto em tokens; o que existe é percentual de uso e horário de renovação.
 */

/** Subconjunto da resposta do `/usage` estruturado (`SDKControlGetUsageResponse`). */
export interface SdkUsageResponseLike {
  subscription_type: string | null;
  rate_limits_available: boolean;
  rate_limits: Record<string, unknown> | null;
}

/** Subconjunto do `SDKRateLimitInfo` do evento `rate_limit_event`. */
export interface RateLimitInfoLike {
  status?: string;
  rateLimitType?: string;
  utilization?: number;
  resetsAt?: number;
}

export type UsageProbe = () => Promise<SdkUsageResponseLike | null>;

type RawWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n * 100) / 100));

function toWindow(w: RawWindow): UsageWindow | null {
  if (!w || typeof w !== "object") return null;
  const u = typeof w.utilization === "number" ? clampPct(w.utilization) : null;
  const r = typeof w.resets_at === "string" && w.resets_at ? new Date(w.resets_at) : null;
  return { utilization: u, resetsAt: r && !Number.isNaN(r.getTime()) ? r.toISOString() : null };
}

const PER_MODEL: Record<string, string> = {
  seven_day_opus: "opus",
  seven_day_sonnet: "sonnet",
};

export function mapSdkUsageResponse(r: SdkUsageResponseLike | null): PlanUsage | null {
  if (!r?.rate_limits_available || !r.rate_limits) return null;
  const rl = r.rate_limits as Record<string, RawWindow>;
  const perModel: PlanUsage["windows"]["perModel"] = [];
  for (const [key, model] of Object.entries(PER_MODEL)) {
    const w = toWindow(rl[key]);
    if (w) perModel.push({ model, ...w });
  }
  return {
    subscription: r.subscription_type ?? null,
    source: "usage_api",
    windows: { fiveHour: toWindow(rl.five_hour), sevenDay: toWindow(rl.seven_day), perModel },
  };
}

/** Utilização do evento pode vir em fração (0–1) ou percentual; `resetsAt` em segundos ou milissegundos. */
function eventWindow(info: RateLimitInfoLike): UsageWindow {
  const raw = typeof info.utilization === "number" ? info.utilization : null;
  const utilization = raw === null ? null : clampPct(raw <= 1 ? raw * 100 : raw);
  const ts = typeof info.resetsAt === "number" ? info.resetsAt : null;
  const resetsAt = ts === null ? null : new Date(ts < 1e12 ? ts * 1000 : ts).toISOString();
  return { utilization, resetsAt };
}

/** Junta os últimos eventos por tipo de janela num diagnóstico; `null` sem nenhum evento útil. */
export function planUsageFromRateLimits(
  latest: ReadonlyMap<string, RateLimitInfoLike>,
): PlanUsage | null {
  if (latest.size === 0) return null;
  const five = latest.get("five_hour");
  const seven = latest.get("seven_day");
  const perModel: PlanUsage["windows"]["perModel"] = [];
  for (const [key, model] of Object.entries(PER_MODEL)) {
    const info = latest.get(key);
    if (info) perModel.push({ model, ...eventWindow(info) });
  }
  if (!five && !seven && perModel.length === 0) return null;
  return {
    subscription: null,
    source: "rate_limit_event",
    windows: {
      fiveHour: five ? eventWindow(five) : null,
      sevenDay: seven ? eventWindow(seven) : null,
      perModel,
    },
  };
}

/**
 * Sonda real: abre uma sessão do SDK com entrada em streaming que nunca envia mensagem (nenhum token é gasto),
 * pede o `/usage` estruturado e encerra. Qualquer falha (método removido, CLI ausente, tempo) devolve `null`.
 */
export function createSdkUsageProbe(o: {
  binaryPath: string | null;
  timeoutMs?: number;
}): UsageProbe {
  return async () => {
    let release: () => void = () => {};
    const idle = new Promise<void>((r) => {
      release = r;
    });
    // entrada em streaming que nunca envia mensagem: termina quando a sonda acaba
    const prompt: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({
        next: () => idle.then(() => ({ done: true as const, value: undefined as never })),
      }),
    };
    let q: { [k: string]: unknown } | null = null;
    try {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      type SdkOptions = NonNullable<Parameters<typeof sdk.query>[0]["options"]>;
      q = sdk.query({
        prompt: prompt as unknown as Parameters<typeof sdk.query>[0]["prompt"],
        options: {
          settingSources: [],
          ...(o.binaryPath ? { pathToClaudeCodeExecutable: o.binaryPath } : {}),
        } as unknown as SdkOptions,
      }) as unknown as { [k: string]: unknown };
      const method = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof method !== "function") return null;
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), o.timeoutMs ?? 15_000));
      const answer = (
        method as (opts: { skipBehaviors: boolean }) => Promise<SdkUsageResponseLike>
      ).call(q, { skipBehaviors: true });
      return await Promise.race([answer, timeout]);
    } catch {
      return null;
    } finally {
      release();
      try {
        const close = q?.close ?? q?.return;
        if (typeof close === "function") await (close as () => unknown).call(q);
      } catch {
        // sessão já encerrada
      }
    }
  };
}
