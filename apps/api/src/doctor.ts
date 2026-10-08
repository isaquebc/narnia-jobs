import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Provider } from "@narnia-jobs/providers";

export interface DoctorDeps {
  provider: Provider;
  dataDir: string;
  redisPing: () => Promise<string>;
  workerHeartbeat: () => Promise<string | null>;
}

export interface DoctorReport {
  ok: boolean;
  checks: {
    auth: "volume" | "token" | "other" | "none";
    cliInstalled: boolean;
    cliVersion: string | null;
    redis: boolean;
    dataDirWritable: boolean;
    workerAlive: boolean;
  };
  hints: string[];
}

/** `narnia-jobs doctor`: login (volume/token/nenhum), Redis, pasta de dados e heartbeat do worker. */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const hints: string[] = [];
  const status = await deps.provider.detect();
  let auth: DoctorReport["checks"]["auth"] = "none";
  if (status.loggedIn) {
    auth =
      status.authMethod === "oauth_token"
        ? "token"
        : status.authMethod === "claude.ai"
          ? "volume"
          : "other";
  } else {
    hints.push(
      "Não logado: rode `narnia-jobs login` (login no volume) ou defina CLAUDE_CODE_OAUTH_TOKEN no .env (token de `claude setup-token`).",
    );
  }
  if (!status.installed) hints.push("CLI do Claude Code não encontrado na imagem.");

  let redis = false;
  try {
    redis = (await deps.redisPing()).toUpperCase().includes("PONG");
  } catch {
    redis = false;
  }
  if (!redis) hints.push("Redis inacessível: verifique o serviço `redis` do compose.");

  let dataDirWritable = false;
  try {
    mkdirSync(deps.dataDir, { recursive: true });
    const probe = join(deps.dataDir, `.doctor-${process.pid}`);
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    dataDirWritable = true;
  } catch {
    dataDirWritable = false;
    hints.push(`Pasta de dados não gravável: ${deps.dataDir}`);
  }

  let workerAlive = false;
  try {
    const beat = await deps.workerHeartbeat();
    workerAlive = beat !== null && Date.now() - new Date(beat).getTime() < 60_000;
  } catch {
    workerAlive = false;
  }
  if (!workerAlive) hints.push("Worker sem heartbeat recente: verifique o serviço `worker`.");

  const checks = {
    auth,
    cliInstalled: status.installed,
    cliVersion: status.version,
    redis,
    dataDirWritable,
    workerAlive,
  };
  return { ok: auth !== "none" && redis && dataDirWritable && workerAlive, checks, hints };
}
