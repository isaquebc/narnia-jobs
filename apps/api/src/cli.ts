import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  googleCalendarConnectSteps,
  parseGoogleCalendarStatus,
  resolveBackupDir,
} from "@narnia-jobs/core";
import { createProviderFromEnv, resolveClaudeBinary } from "@narnia-jobs/providers";
import IORedis from "ioredis";
import { runDoctor } from "./doctor";
import { probeMcp } from "./mcp/probe";

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
    mcpProbe: () => probeMcp(`http://127.0.0.1:${process.env.PORT ?? "3100"}`, apiToken()),
  });
  redis.disconnect();
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

/** Token da instância: `NARNIA_TOKEN` (dev) ou o persistido em `<dados>/.token` (produção). */
function apiToken(): string {
  if (process.env.NARNIA_TOKEN) return process.env.NARNIA_TOKEN;
  try {
    return readFileSync(join(dataDir, ".token"), "utf8").trim();
  } catch {
    return "";
  }
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

/**
 * Google Calendar opcional (F07/M7, F07-4): `google status` lê o `claude mcp list`; `google connect <client-id>`
 * registra o MCP oficial com o cliente OAuth da pessoa (o CLI pede o segredo) e abre o login (callback na 8089).
 */
function google(sub: string, clientId: string | undefined): number {
  const bin = resolveClaudeBinary({ explicit: process.env.NARNIA_CLAUDE_BIN });
  if (!bin) {
    console.error("CLI do Claude Code não encontrado na imagem.");
    return 1;
  }
  if (sub === "status") {
    const r = spawnSync(bin, ["mcp", "list"], { encoding: "utf8", timeout: 20_000 });
    console.log(
      JSON.stringify(parseGoogleCalendarStatus(r.stdout ?? null, r.error?.message), null, 2),
    );
    return 0;
  }
  // o client ID vai para o shell: só o formato do Google (dígitos, letras, ponto e hífen)
  if (sub === "connect" && clientId && /^[\w.-]+$/.test(clientId)) {
    const steps = googleCalendarConnectSteps({ clientId, callbackPort: 8089 });
    console.log(`URI de redirecionamento do cliente OAuth: ${steps.redirectUri}`);
    const add = spawnSync("sh", ["-c", steps.add.replace(/^claude /, `"${bin}" `)], {
      stdio: "inherit",
    });
    if (add.status !== 0) return add.status ?? 1;
    return spawnSync(bin, ["mcp", "login", "google-calendar"], { stdio: "inherit" }).status ?? 1;
  }
  console.log("narnia-jobs google status | google connect <client-id>");
  return 2;
}

function usage(): void {
  console.log(`narnia-jobs <comando>
  doctor          verifica login (volume/token), Redis, pasta de dados e worker
  login           login interativo da assinatura dentro do container
  install-plugin  roda no host: ./start.sh install-plugin (ou .\\start.ps1 install-plugin)
  google status   Google Calendar (opcional, F07): conectado, precisa de login ou não configurado
  google connect <client-id>  registra o MCP do Google com o seu cliente OAuth e abre o login
  evals prompts [nome…] [--strict]  prompts estruturados sobre os datasets no Phoenix (pela ponte)
  evals chat [id…] [--strict]       conversas de referência com o recrutador, num banco temporário isolado
  evals pdf [--strict]              leitura do PDF fictício (tool Read), num banco temporário isolado
  evals cv-review [--strict]        revisor do CV com as imagens das páginas (precisa do serviço browser)
  evals all [--strict]              tudo acima`);
}

let code = 0;
switch (cmd) {
  case "doctor":
    code = await doctor();
    break;
  case "login":
    code = login();
    break;
  case "google": {
    const [, sub = "", clientId] = process.argv.slice(2);
    code = google(sub, clientId);
    break;
  }
  case "install-plugin":
    // o plugin vai para o Claude Code do computador (host), não para o container: quem instala é o lançador
    console.log(
      "install-plugin roda no seu computador: ./start.sh install-plugin (Windows: .\\start.ps1 install-plugin).",
    );
    break;
  case "evals": {
    // avaliações no Phoenix: prompts (Playground pela ponte), chat e pdf (banco temporário isolado), all
    const [, sub = "", ...rest] = process.argv.slice(2);
    if (sub === "prompts" || sub === "all") {
      const { runPromptEvals } = await import("./evals/cli-prompts");
      code = await runPromptEvals(sub === "all" ? rest.filter((a) => a.startsWith("--")) : rest);
    }
    if (sub === "chat" || sub === "pdf" || sub === "cv-review" || sub === "all") {
      const { runSandboxEvals } = await import("./evals/cli-evals");
      const flags = rest.filter((a) => a.startsWith("--"));
      if (sub === "all") {
        code = Math.max(
          code,
          await runSandboxEvals("chat", flags),
          await runSandboxEvals("pdf", flags),
          await runSandboxEvals("cv-review", flags),
        );
      } else code = await runSandboxEvals(sub, rest);
    }
    // calibração dos juízes: falsos positivos e negativos em respostas rotuladas (2026-10-24)
    if (sub === "calibration") {
      const { runCalibration } = await import("./evals/calibration");
      code = await runCalibration(rest);
    }
    // relatórios da rodada (F04-fix-fundamentacao): recall da busca e comparação antes → depois
    if (sub === "search") {
      const { runSearchEvals } = await import("./evals/cli-report");
      code = await runSearchEvals(rest);
    }
    if (sub === "compare") {
      const { runCompare } = await import("./evals/cli-report");
      code = runCompare(rest);
    }
    if (
      !["prompts", "chat", "pdf", "cv-review", "calibration", "search", "compare", "all"].includes(
        sub,
      )
    ) {
      console.log(
        "narnia-jobs evals prompts|chat|pdf|cv-review|calibration|search|compare|all [nome…] [--strict]",
      );
      code = 2;
    }
    break;
  }
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
