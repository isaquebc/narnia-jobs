import { execFileSync } from "node:child_process";
import { bridgeKey, type Repos, resolveBridgeSettings } from "@narnia-jobs/core";
import { nowUtc } from "@narnia-jobs/shared";
import type { EvalSyncResult } from "./eval-sync";
import type { PhoenixAdmin } from "./phoenix-admin";
import type { SyncResult } from "./prompt-sync";

/** Uma sincronização completa: prompts (M2) e datasets + avaliadores (M3). */
export interface FullSync {
  prompts: SyncResult[];
  evaluators: EvalSyncResult;
}

/**
 * Preparação do Phoenix no boot do api (M2): com o Phoenix no ar, registra a ponte da assinatura quando ela está ligada
 * e ainda não existe lá (padrão AV-2) e sincroniza os prompts do repositório (AV-4). O Phoenix pode subir depois do
 * api: tenta algumas vezes e desiste em silêncio (o botão em Configurações › Avaliações faz o mesmo depois).
 */
const LAST_SYNC_KEY = "evals.prompts_last_sync";

export interface PromptSyncSummary {
  at: string;
  created: number;
  updated: number;
  unchanged: number;
  datasets: number;
  evaluatorsCreated: number;
  evaluatorsUpdated: number;
  error: string | null;
}

export function recordPromptSync(repos: Repos, r: FullSync | Error): PromptSyncSummary {
  const ok = r instanceof Error ? null : r;
  const count = (a: SyncResult["action"]) => ok?.prompts.filter((x) => x.action === a).length ?? 0;
  const summary: PromptSyncSummary = {
    at: nowUtc(),
    created: count("created"),
    updated: count("updated"),
    unchanged: count("unchanged"),
    datasets: ok?.evaluators.datasets ?? 0,
    evaluatorsCreated:
      (ok?.evaluators.evaluatorsCreated ?? 0) + (ok?.evaluators.judgesCreated ?? 0),
    evaluatorsUpdated:
      (ok?.evaluators.evaluatorsUpdated ?? 0) + (ok?.evaluators.judgesUpdated ?? 0),
    error: r instanceof Error ? r.message : null,
  };
  repos.settings.set(LAST_SYNC_KEY, summary);
  return summary;
}

export function lastPromptSync(repos: Repos): PromptSyncSummary | null {
  return repos.settings.get<PromptSyncSummary>(LAST_SYNC_KEY) ?? null;
}

/** Commit do código em execução (descrição das versões): `NARNIA_GIT_COMMIT` ou o `git` da pasta; null sem git. */
export function gitCommit(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NARNIA_GIT_COMMIT?.trim()) return env.NARNIA_GIT_COMMIT.trim();
  try {
    return (
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export async function setupPhoenix(o: {
  repos: Repos;
  admin: PhoenixAdmin;
  bridgeUrl: string;
  /** Sincroniza apontando para o provedor da ponte (null = provedor Anthropic padrão). */
  sync: (customProviderId: string | null) => Promise<FullSync>;
  retries?: number;
  retryMs?: number;
}): Promise<{ registered: boolean; synced: number }> {
  const retries = o.retries ?? 10;
  let status = await o.admin.status();
  for (let i = 0; i < retries && !status.reachable; i++) {
    await new Promise((r) => setTimeout(r, o.retryMs ?? 3000));
    status = await o.admin.status();
  }
  if (!status.reachable) return { registered: false, synced: 0 };
  const bridgeOn = resolveBridgeSettings(o.repos.settings).enabled;
  let registered = false;
  if (bridgeOn && !status.providerRegistered) {
    await o.admin.registerBridge({ key: bridgeKey(o.repos.settings), bridgeUrl: o.bridgeUrl });
    registered = true;
    status = await o.admin.status();
  }
  try {
    const r = await o.sync(bridgeOn ? status.providerId : null);
    recordPromptSync(o.repos, r);
    return {
      registered,
      synced:
        r.prompts.filter((x) => x.action !== "unchanged").length +
        r.evaluators.evaluatorsCreated +
        r.evaluators.evaluatorsUpdated +
        r.evaluators.judgesCreated +
        r.evaluators.judgesUpdated,
    };
  } catch (e) {
    recordPromptSync(o.repos, e as Error);
    return { registered, synced: 0 };
  }
}
