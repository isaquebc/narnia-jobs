import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./open";

/**
 * Backups do banco (F03-fix L1, incidente de 2026-10-10: o banco do dono foi recriado do zero sem nenhuma cópia).
 *
 * - Pasta fora dos dados (`NARNIA_BACKUP_DIR`; `./backups` na raiz do projeto na instância do dono, FX-1).
 * - No boot do api, no máximo um por dia, só de banco com dados de usuário (cópia vazia nunca empurra cópia boa
 *   para fora); antes de migration também (`migrate` usa `writeBackup`).
 * - Poda única: no máximo `backups.max` arquivos `narnia-boot-*`/`narnia-pre-*` no total (padrão 5, FX-2), sai o
 *   mais antigo. Nunca apaga arquivo que não criou (`narnia-before-restore-*` do lançador fica de fora).
 * - Uploads copiados por nome (sha) para `<backups>/uploads`, só os que faltam; o mesmo com os templates de CV e os
 *   anexos das candidaturas (F07/M3).
 * - Tudo à prova de falha: erro vira `error` no resultado, nunca exceção no boot.
 */
export const DEFAULT_BACKUPS_MAX = 5;
export const BACKUPS_MAX_KEY = "backups.max";

const PRUNABLE = /^narnia-(boot|pre-.+)-\d{4}-\d{2}-\d{2}T.+\.sqlite$/;
const OURS = /^narnia-.+\.sqlite$/;

export interface BackupFile {
  file: string;
  path: string;
  at: string;
}

/** `NARNIA_BACKUP_DIR`: vazio → `<dados>/backups` (instância antiga, antes de reiniciar o lançador); `off` → desligado. */
export function resolveBackupDir(
  env: Record<string, string | undefined>,
  dataDir: string,
): string | null {
  const v = env.NARNIA_BACKUP_DIR?.trim();
  if (!v) return join(dataDir, "backups");
  if (v === "off") return null;
  return v;
}

/** `backups.max` de `settings` (padrão 5, mínimo 1); banco sem a tabela ainda → padrão. */
export function readBackupsMax(db: Db): number {
  try {
    const row = db.prepare("select value_json from settings where key = ?").get(BACKUPS_MAX_KEY) as
      | { value_json: string }
      | undefined;
    if (!row) return DEFAULT_BACKUPS_MAX;
    const n = Math.floor(Number(JSON.parse(row.value_json)));
    return Number.isFinite(n) ? Math.max(1, n) : DEFAULT_BACKUPS_MAX;
  } catch {
    return DEFAULT_BACKUPS_MAX;
  }
}

/** Há algo do usuário no banco (identidade, perfil, arquivo enviado ou experiência)? */
export function hasUserData(db: Db): boolean {
  for (const table of ["user", "profile", "source_file", "experience"]) {
    try {
      if (db.prepare(`select 1 from ${table} limit 1`).get()) return true;
    } catch {
      // tabela ainda não existe (banco antes da 0001)
    }
  }
  return false;
}

const stampOf = (now: Date) => now.toISOString().replace(/[:.]/g, "-");

export function listBackups(dir: string | null): BackupFile[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => OURS.test(f))
    .map((f) => {
      const path = join(dir, f);
      return {
        file: f,
        path,
        at: new Date(statSync(path).mtimeMs).toISOString(),
        t: statSync(path).mtimeMs,
      };
    })
    .sort((a, b) => b.t - a.t || b.file.localeCompare(a.file))
    .map(({ t: _t, ...rest }) => rest);
}

/** Mantém só os `max` mais recentes entre `narnia-boot-*` e `narnia-pre-*`; devolve os removidos. */
export function pruneBackups(dir: string, max: number): string[] {
  const keep = Math.max(1, Math.floor(max));
  const prunable = listBackups(dir).filter((b) => PRUNABLE.test(b.file));
  const removed = prunable.slice(keep);
  for (const b of removed) rmSync(b.path, { force: true });
  return removed.map((b) => b.file);
}

/** Cópia consistente (`VACUUM INTO`) em `narnia-<motivo>-<instante>.sqlite` + poda. */
export function writeBackup(
  db: Db,
  dir: string,
  reason: string,
  opts: { max?: number; now?: Date } = {},
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `narnia-${reason}-${stampOf(opts.now ?? new Date())}.sqlite`);
  db.prepare("vacuum into ?").run(path);
  pruneBackups(dir, opts.max ?? readBackupsMax(db));
  return path;
}

/** Copia `<dados>/uploads/*` para `<backups>/uploads/` (nome = sha), só os que faltam. */
export function backupUploads(dataDir: string, dir: string): number {
  return copyMissing(dataDir, dir, "uploads");
}

/** Templates de CV enviados (F05): o `.zip` original de cada um; a prévia e os PDFs são derivados e ficam de fora. */
export function backupTemplates(dataDir: string, dir: string): number {
  return copyMissing(dataDir, dir, "templates", (f) => f.endsWith(".zip"));
}

/** Anexos das candidaturas (F07/M3): pasta plana, nome = id do anexo. */
export function backupJobApplicationFiles(dataDir: string, dir: string): number {
  return copyMissing(dataDir, dir, "job-applications");
}

function copyMissing(
  dataDir: string,
  dir: string,
  sub: string,
  keep: (f: string) => boolean = () => true,
): number {
  const src = join(dataDir, sub);
  if (!existsSync(src)) return 0;
  const dst = join(dir, sub);
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(src)) {
    const from = join(src, f);
    if (!keep(f) || !statSync(from).isFile() || existsSync(join(dst, f))) continue;
    copyFileSync(from, join(dst, f));
    copied++;
  }
  return copied;
}

export interface BootBackupResult {
  created: string | null;
  skipped?: "disabled" | "empty" | "already_today";
  uploadsCopied?: number;
  error?: string;
}

export function backupOnBoot(input: {
  db: Db;
  dataDir: string;
  backupDir: string | null;
  max?: number;
  now?: Date;
}): BootBackupResult {
  const { db, dataDir, backupDir } = input;
  if (!backupDir) return { created: null, skipped: "disabled" };
  try {
    if (!hasUserData(db)) return { created: null, skipped: "empty" };
    const now = input.now ?? new Date();
    const uploadsCopied =
      backupUploads(dataDir, backupDir) +
      backupTemplates(dataDir, backupDir) +
      backupJobApplicationFiles(dataDir, backupDir);
    const today = `narnia-boot-${now.toISOString().slice(0, 10)}`;
    if (listBackups(backupDir).some((b) => b.file.startsWith(today)))
      return { created: null, skipped: "already_today", uploadsCopied };
    const created = writeBackup(db, backupDir, "boot", {
      max: input.max ?? readBackupsMax(db),
      now,
    });
    return { created, uploadsCopied };
  } catch (e) {
    return { created: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface FreshDatabase {
  latestBackup: BackupFile | null;
  hasLogs: boolean;
}

/**
 * Banco sem dados de usuário, mas com histórico na instância (backups ou logs de requisições): sinal de que o banco
 * foi recriado (incidente de 2026-10-10). Devolve o backup mais recente para a notificação; `null` caso contrário.
 */
export function detectFreshDatabase(input: {
  db: Db;
  backupDir: string | null;
  logsDir: string;
}): FreshDatabase | null {
  if (hasUserData(input.db)) return null;
  const latestBackup = listBackups(input.backupDir)[0] ?? null;
  const hasLogs =
    existsSync(input.logsDir) && readdirSync(input.logsDir).some((f) => /^api-.*\.jsonl$/.test(f));
  if (!latestBackup && !hasLogs) return null;
  return { latestBackup, hasLogs };
}
