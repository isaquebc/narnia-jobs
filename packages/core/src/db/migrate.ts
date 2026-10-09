import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nowUtc } from "@narnia-jobs/shared";
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
}

/**
 * Migrations que reconstroem tabelas referenciadas (SQLite não altera CHECK/NOT NULL) declaram na primeira linha
 * `-- narnia: foreign-keys-off`: o executor desliga as chaves estrangeiras fora da transação (o pragma não muda dentro
 * dela), roda `pragma foreign_key_check` antes do commit (qualquer referência quebrada desfaz tudo) e religa as FKs no
 * estado anterior, com sucesso ou erro (F03 §2.9-2, F03-17).
 */
const FK_OFF = /^--\s*narnia:\s*foreign-keys-off/m;

export function migrate(db: Db, opts: MigrateOptions = {}): { applied: string[] } {
  db.exec(
    "create table if not exists schema_migrations (name text primary key, applied_at text not null)",
  );
  const done = new Set(
    (db.prepare("select name from schema_migrations").all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
  const applied: string[] = [];
  const insert = db.prepare("insert into schema_migrations (name, applied_at) values (?, ?)");
  for (const m of listMigrations()) {
    if (done.has(m.name)) {
      if (opts.until === m.name) break;
      continue;
    }
    const fkOff = FK_OFF.test(m.sql);
    const fkBefore = (db.prepare("pragma foreign_keys").get() as { foreign_keys: number })
      .foreign_keys;
    if (fkOff) db.exec("pragma foreign_keys = off");
    try {
      db.exec("begin");
      try {
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
      } catch (e) {
        db.exec("rollback");
        throw e;
      }
    } finally {
      if (fkOff) db.exec(`pragma foreign_keys = ${fkBefore ? "on" : "off"}`);
    }
    applied.push(m.name);
    if (opts.until === m.name) break;
  }
  return { applied };
}
