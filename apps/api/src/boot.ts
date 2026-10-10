import { join } from "node:path";
import {
  type BootBackupResult,
  backupOnBoot,
  type Db,
  detectFreshDatabase,
  type FreshDatabase,
  hasUserData,
  type Repos,
} from "@narnia-jobs/core";

/** Assunto fixo da notificação de banco recriado (uma aberta por vez). */
export const DATABASE_SUBJECT_ID = "database";

export interface BootDataResult {
  backup: BootBackupResult;
  fresh: FreshDatabase | null;
}

/**
 * Proteção de dados no boot do api (F03-fix L1, incidente de 2026-10-10). Nunca lança: backup que falha vira aviso.
 * 1. Backup do dia fora da pasta de dados (só banco com dados de usuário).
 * 2. Banco vazio com histórico (backups ou logs) → notificação crítica com o backup mais recente e o comando de
 *    restauração; banco com dados → resolve o aviso antigo.
 */
export function bootData(input: {
  db: Db;
  repos: Repos;
  dataDir: string;
  backupDir: string | null;
  now?: Date;
  log?: (msg: string) => void;
}): BootDataResult {
  const log = input.log ?? ((m: string) => console.warn(m));
  const backup = backupOnBoot({
    db: input.db,
    dataDir: input.dataDir,
    backupDir: input.backupDir,
    ...(input.now ? { now: input.now } : {}),
  });
  if (backup.error)
    log(`[api] aviso: backup no boot falhou (${backup.error}); seguindo sem backup`);
  else if (backup.created) log(`[api] backup do dia: ${backup.created}`);

  let fresh: FreshDatabase | null = null;
  try {
    fresh = detectFreshDatabase({
      db: input.db,
      backupDir: input.backupDir,
      logsDir: join(input.dataDir, "logs"),
    });
    if (fresh) {
      const b = fresh.latestBackup;
      input.repos.notifications.upsert({
        kind: "data.recreated",
        subjectKind: "database",
        subjectId: DATABASE_SUBJECT_ID,
        severity: "error",
        title: "Seu banco de dados foi recriado vazio",
        body: b
          ? `Há um backup de ${b.at}: ${b.file}. Para restaurar, pare de usar o app e rode no terminal: ./start.sh restore ${b.file}`
          : "Não há backup disponível. O histórico de uso indica que existiam dados nesta instância.",
        actionUrl: "/configuracoes",
      });
      log(
        `[api] aviso: banco sem dados de usuário, mas com histórico${b ? ` (backup ${b.file})` : ""}`,
      );
    } else if (hasUserData(input.db)) {
      input.repos.notifications.resolveSubject("database", DATABASE_SUBJECT_ID, ["data.recreated"]);
    }
  } catch (e) {
    log(
      `[api] aviso: verificação de banco recriado falhou (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  return { backup, fresh };
}
