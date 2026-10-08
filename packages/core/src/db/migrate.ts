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

export function migrate(db: Db): { applied: string[] } {
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
    if (done.has(m.name)) continue;
    db.exec("begin");
    try {
      db.exec(m.sql);
      insert.run(m.name, nowUtc());
      db.exec("commit");
    } catch (e) {
      db.exec("rollback");
      throw e;
    }
    applied.push(m.name);
  }
  return { applied };
}
