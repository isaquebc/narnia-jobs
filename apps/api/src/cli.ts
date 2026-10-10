import { spawnSync } from "node:child_process";
import { resolveBackupDir } from "@narnia-jobs/core";
import { createProviderFromEnv, resolveClaudeBinary } from "@narnia-jobs/providers";
import IORedis from "ioredis";
import { runDoctor } from "./doctor";

/**
 * CLI `narnia-jobs` dentro da imagem (F01 §2.6): doctor | login | install-plugin.
 * No host, os scripts `start.sh`/`start.ps1` delegam para `docker compose run --rm api narnia-jobs <cmd>`.
 */
const [cmd = "help"] = process.argv.slice(2);
const dataDir = process.env.NARNIA_DATA_DIR ?? "/data";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const prefix = process.env.NARNIA_QUEUE_PREFIX ?? "narnia";

async function doctor(): Promise<number> {
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 3000,
  });
  const report = await runDoctor({
    provider: createProviderFromEnv(),
    dataDir,
    redisPing: async () => {
      await redis.connect();
      return redis.ping();
    },
    workerHeartbeat: () => redis.get(`${prefix}:worker:heartbeat`),
    backupDir: resolveBackupDir(process.env, dataDir),
  });
  redis.disconnect();
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

function login(): number {
  const bin = resolveClaudeBinary();
  if (!bin) {
    console.error("CLI do Claude Code não encontrado na imagem.");
    return 1;
  }
  console.log("Login da assinatura dentro do container (a credencial fica no volume claude-auth).");
  const r = spawnSync(bin, ["auth", "login"], { stdio: "inherit" });
  return r.status ?? 1;
}

function usage(): void {
  console.log(`narnia-jobs <comando>
  doctor          verifica login (volume/token), Redis, pasta de dados e worker
  login           login interativo da assinatura dentro do container
  install-plugin  instala o plugin no Claude Code do host (disponível em F04)`);
}

let code = 0;
switch (cmd) {
  case "doctor":
    code = await doctor();
    break;
  case "login":
    code = login();
    break;
  case "install-plugin":
    console.log("`install-plugin` chega com o F04 (servidor MCP + plugin/).");
    break;
  case "help":
  case "--help":
  case "-h":
    usage();
    break;
  default:
    usage();
    code = 2;
}
process.exit(code);
