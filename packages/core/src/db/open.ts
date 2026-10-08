import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Abre o SQLite (F01 §2.5/§3): WAL para api e worker lerem/escreverem o mesmo arquivo, `busy_timeout` de 5 s
 * para escritas curtas concorrentes, chaves estrangeiras ligadas. `:memory:` para testes.
 */
export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("pragma journal_mode = wal");
  db.exec("pragma busy_timeout = 5000");
  db.exec("pragma foreign_keys = on");
  return db;
}

export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec("begin immediate");
  try {
    const result = fn();
    db.exec("commit");
    return result;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}
