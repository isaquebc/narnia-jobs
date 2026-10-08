import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listMigrations, migrate, openDatabase } from "../../src/db";

const EXPECTED_TABLES = [
  "schema_migrations",
  "settings",
  "user",
  "language",
  "experience",
  "achievement",
  "education",
  "skill",
  "profile",
  "salary_reference",
  "source_file",
  "file_digest",
  "reading",
  "reading_segment",
  "ingestion_run",
  "ingestion_proposal",
  "fact_source",
  "job",
  "usage_event",
];

function tables(db: ReturnType<typeof openDatabase>): string[] {
  return (
    db.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
}

describe("db/migrate (F01 §3, M3)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("aplica todas as migrations do zero e cria todas as tabelas de §3", () => {
    const db = openDatabase(":memory:");
    const result = migrate(db);
    expect(result.applied).toEqual(listMigrations().map((m) => m.name));
    expect(result.applied[0]).toBe("0001_init");
    for (const t of EXPECTED_TABLES) expect(tables(db)).toContain(t);
  });

  it("é idempotente: segunda execução não aplica nada e não quebra", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(
      (db.prepare("select count(*) as n from schema_migrations").get() as { n: number }).n,
    ).toBe(listMigrations().length);
  });

  it("abre em arquivo com WAL, busy_timeout de 5 s e foreign_keys ligadas", () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-db-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "narnia.sqlite"));
    expect((db.prepare("pragma journal_mode").get() as { journal_mode: string }).journal_mode).toBe(
      "wal",
    );
    expect((db.prepare("pragma busy_timeout").get() as { timeout: number }).timeout).toBe(5000);
    expect((db.prepare("pragma foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(
      1,
    );
    db.close();
  });

  it("semeia settings.facts_version = 0 e uma referência salarial DIEESE corrente para BR", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fv = db.prepare("select value_json from settings where key = 'facts_version'").get() as {
      value_json: string;
    };
    expect(JSON.parse(fv.value_json)).toBe(0);
    const ref = db
      .prepare(
        "select * from salary_reference where country = 'BR' and source = 'dieese' and is_current = 1",
      )
      .get() as Record<string, unknown>;
    expect(ref.indicator).toBe("salario_minimo_necessario");
    expect(ref.currency).toBe("BRL");
    expect(ref.period).toBe("monthly");
    expect(String(ref.reference_month)).toMatch(/^\d{4}-\d{2}$/);
    expect(String(ref.source_url)).toContain("dieese.org.br");
  });
});
