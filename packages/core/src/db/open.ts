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

/** Transações abertas por conexão: uma chamada dentro de outra vira savepoint na de fora (F14/M5: negativa que grava nota). */
const depth = new WeakMap<Db, number>();

export function withTransaction<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) {
    // dentro de outra: savepoint, para que um erro capturado por quem chama desfaça só esta parte
    const name = `narnia_sp_${d}`;
    depth.set(db, d + 1);
    db.exec(`savepoint ${name}`);
    try {
      const result = fn();
      db.exec(`release ${name}`);
      return result;
    } catch (e) {
      db.exec(`rollback to ${name}`);
      db.exec(`release ${name}`);
      throw e;
    } finally {
      depth.set(db, d);
    }
  }
  depth.set(db, 1);
  try {
    return outer(db, fn);
  } finally {
    depth.set(db, 0);
  }
}

function outer<T>(db: Db, fn: () => T): T {
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
