import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nowUtc } from "@narnia-jobs/shared";
import { hasUserData, writeBackup } from "./backup";
import type { Db } from "./open";

export interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Migrations em SQL puro, numeradas (`0001_init.sql`...), só para frente (decisão F01-2). */
export function listMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f.replace(/\.sql$/, ""), sql: readFileSync(MIGRATIONS_DIR + f, "utf8") }));
}

export interface MigrateOptions {
  /** Para depois de aplicar esta migration (inclusive). Usado pelos testes de upgrade. */
  until?: string;
  /**
   * Pasta de backups: antes de migrar um banco que já tinha migrations aplicadas e tem dados de usuário, grava uma
   * cópia consistente (`VACUUM INTO`) em `narnia-pre-<migration>-<instante>.sqlite`, com a mesma poda única do
   * backup de boot (`backups.max`, F03-fix L1). `null`/ausente desliga.
   */
  backupDir?: string | null;
  /** Só para testes: chamado depois de calcular as pendentes e antes de travar (simula outro processo migrando). */
  afterPlan?: () => void;
}

/**
 * Migrations que reconstroem tabelas referenciadas (SQLite não altera CHECK/NOT NULL) declaram na primeira linha
 * `-- narnia: foreign-keys-off`: o executor desliga as chaves estrangeiras fora da transação (o pragma não muda dentro
 * dela), roda `pragma foreign_key_check` antes do commit (qualquer referência quebrada desfaz tudo) e religa as FKs no
 * estado anterior, com sucesso ou erro (F03 §2.9-2, F03-17).
 *
 * Concorrência (regressão 2026-10-10): api e worker migram no boot ao mesmo tempo. Cada migration roda em
 * `begin immediate` (trava de escrita) e o registro em `schema_migrations` é conferido de novo depois da trava,
 * então quem chega depois só pula o que o outro processo já aplicou.
 */
const FK_OFF = /^--\s*narnia:\s*foreign-keys-off/m;

function appliedNames(db: Db): Set<string> {
  return new Set(
    (db.prepare("select name from schema_migrations").all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
}

export function migrate(db: Db, opts: MigrateOptions = {}): { applied: string[] } {
  db.exec(
    "create table if not exists schema_migrations (name text primary key, applied_at text not null)",
  );
  const done = appliedNames(db);
  const all = listMigrations();
  const untilIdx = opts.until ? all.findIndex((m) => m.name === opts.until) : -1;
  const stop = untilIdx >= 0 ? untilIdx : all.length - 1;
  const pending = all.slice(0, stop + 1).filter((m) => !done.has(m.name));
  const applied: string[] = [];
  if (pending.length === 0) return { applied };
  opts.afterPlan?.();
  if (opts.backupDir && done.size > 0 && hasUserData(db))
    writeBackup(db, opts.backupDir, `pre-${(pending[0] as Migration).name}`);
  const insert = db.prepare("insert into schema_migrations (name, applied_at) values (?, ?)");
  for (const m of pending) {
    const fkOff = FK_OFF.test(m.sql);
    const fkBefore = (db.prepare("pragma foreign_keys").get() as { foreign_keys: number })
      .foreign_keys;
    if (fkOff) db.exec("pragma foreign_keys = off");
    try {
      db.exec("begin immediate");
      try {
        if (appliedNames(db).has(m.name)) {
          db.exec("commit");
          continue;
        }
        db.exec(m.sql);
        if (fkOff) {
          const broken = db.prepare("pragma foreign_key_check").all();
          if (broken.length > 0) {
            throw new Error(
              `foreign_key_check falhou em ${m.name}: ${broken.length} referência(s) quebrada(s) ${JSON.stringify(broken.slice(0, 3))}`,
            );
          }
        }
        insert.run(m.name, nowUtc());
        db.exec("commit");
        applied.push(m.name);
      } catch (e) {
        db.exec("rollback");
        throw e;
      }
    } finally {
      if (fkOff) db.exec(`pragma foreign_keys = ${fkBefore ? "on" : "off"}`);
    }
  }
  return { applied };
}
