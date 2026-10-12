import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { listBackups } from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";

export interface DoctorDeps {
  provider: Provider;
  dataDir: string;
  redisPing: () => Promise<string>;
  workerHeartbeat: () => Promise<string | null>;
  /** F03-fix L1 item 5: pasta de backups (ausente = não verificar), raiz do /proc (testes) e pasta de logs. */
  backupDir?: string | null;
  procRoot?: string;
  logsDir?: string;
  /** F04/M5: confere o `/mcp` da instância (devolve o nº de tools); ausente = não verificar. */
  mcpProbe?: () => Promise<number>;
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
    database: { path: string; sizeBytes: number | null; walBytes: number | null };
    /** Processos com o banco APAGADO ainda aberto (sinal do incidente de 2026-10-10). */
    deletedOpen: Array<{ pid: number; fd: string }>;
    lastBackup: { file: string; at: string } | null;
    lastRequest: string | null;
    /** F04/M5: servidor MCP da instância (null quando não verificado). */
    mcp: { ok: boolean; tools: number } | null;
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

  const dbPath = join(deps.dataDir, "narnia.sqlite");
  const size = (p: string) => (existsSync(p) ? statSync(p).size : null);
  const database = { path: dbPath, sizeBytes: size(dbPath), walBytes: size(`${dbPath}-wal`) };
  const deletedOpen = findDeletedDatabase(deps.procRoot ?? "/proc");
  for (const d of deletedOpen)
    hints.push(
      `O banco foi APAGADO enquanto o processo ${d.pid} o mantém aberto. NÃO reinicie: copie /proc/${d.pid}/fd/${d.fd} para outro arquivo para recuperar os dados.`,
    );
  const latest =
    deps.backupDir === undefined
      ? null
      : (listBackups(deps.backupDir).filter((b) => /^narnia-(boot|pre-)/.test(b.file))[0] ?? null);
  const lastBackup = latest ? { file: latest.file, at: latest.at } : null;
  if (deps.backupDir !== undefined && !lastBackup)
    hints.push(
      deps.backupDir === null
        ? "Backups desligados (NARNIA_BACKUP_DIR=off)."
        : `Nenhum backup em ${deps.backupDir}: o primeiro é feito no boot do api, quando já houver dados.`,
    );
  const lastRequest = lastLoggedRequest(deps.logsDir ?? join(deps.dataDir, "logs"));
  let mcp: { ok: boolean; tools: number } | null = null;
  if (deps.mcpProbe) {
    try {
      mcp = { ok: true, tools: await deps.mcpProbe() };
    } catch {
      mcp = { ok: false, tools: 0 };
      hints.push(
        "Servidor MCP (/mcp) não respondeu com o token desta instância: o chat e o modo B ficam sem tools.",
      );
    }
  }

  const checks = {
    auth,
    cliInstalled: status.installed,
    cliVersion: status.version,
    redis,
    dataDirWritable,
    workerAlive,
    database,
    deletedOpen,
    lastBackup,
    lastRequest,
    mcp,
  };
  return {
    ok:
      auth !== "none" &&
      redis &&
      dataDirWritable &&
      workerAlive &&
      deletedOpen.length === 0 &&
      (mcp?.ok ?? true),
    checks,
    hints,
  };
}

/** Varre `/proc/<pid>/fd` atrás de `narnia.sqlite* (deleted)` (arquivo removido com o processo ainda aberto). */
export function findDeletedDatabase(procRoot: string): Array<{ pid: number; fd: string }> {
  const found: Array<{ pid: number; fd: string }> = [];
  let pids: string[] = [];
  try {
    pids = readdirSync(procRoot).filter((p) => /^\d+$/.test(p));
  } catch {
    return found;
  }
  for (const pid of pids) {
    let fds: string[] = [];
    try {
      fds = readdirSync(join(procRoot, pid, "fd"));
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        const target = readlinkSync(join(procRoot, pid, "fd", fd));
        if (
          /narnia\.sqlite$/.test(target.replace(/ \(deleted\)$/, "")) &&
          target.endsWith(" (deleted)")
        )
          found.push({ pid: Number(pid), fd });
      } catch {
        // fd fechado no meio da varredura
      }
    }
  }
  return found;
}

/** Instante da última requisição registrada (`api-*.jsonl` mais recente, última linha). */
export function lastLoggedRequest(logsDir: string): string | null {
  try {
    const files = readdirSync(logsDir)
      .filter((f) => /^api-.*\.jsonl$/.test(f))
      .sort();
    const last = files.at(-1);
    if (!last) return null;
    const lines = readFileSync(join(logsDir, last), "utf8").trim().split("\n").filter(Boolean);
    const ts = (JSON.parse(lines.at(-1) ?? "{}") as { ts?: string }).ts;
    return ts ?? null;
  } catch {
    return null;
  }
}
