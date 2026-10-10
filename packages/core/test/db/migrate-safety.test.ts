import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/db";

/**
 * Regressão 2026-10-10 (instância do dono): api e worker rodam migrate no boot ao mesmo tempo; o api leu a lista de
 * migrations aplicadas antes de o worker aplicar a 0003 e tentou aplicá-la de novo ("duplicate column name: match").
 * E toda migration num banco com dados passa a gerar backup antes (VACUUM INTO), para nunca perder dados do usuário.
 */
describe("migrate · concorrência e backup", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("recheca depois de obter a trava: outra conexão que aplicou a migration no meio não causa erro", () => {
    dir = mkdtempSync(join(tmpdir(), "narnia-mig-"));
    const file = join(dir, "narnia.sqlite");
    const a = openDatabase(file);
    const b = openDatabase(file);
    migrate(a, { until: "0002_profiles" });
    // a "planeja" com a lista antiga; antes de travar, b aplica tudo (o worker na corrida real)
    let raced = false;
    expect(() =>
      migrate(a, {
        afterPlan: () => {
          raced = true;
          migrate(b);
        },
      }),
    ).not.toThrow();
    expect(raced).toBe(true);
    const names = (
      a.prepare("select name from schema_migrations").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).toEqual(["0001_init", "0002_profiles", "0003_ingest"]);
    a.close();
    b.close();
  });

  it("faz backup antes de migrar um banco que já tem migrations aplicadas", () => {
    dir = mkdtempSync(join(tmpdir(), "narnia-mig-"));
    const file = join(dir, "narnia.sqlite");
    const backups = join(dir, "backups");
    const db = openDatabase(file);
    migrate(db, { until: "0002_profiles" });
    db.exec("insert into settings (key, value_json) values ('marcador', '\"ok\"')");
    // pré-migration só copia banco com dados de usuário (F03-fix L1: cópia vazia nunca empurra cópia boa para fora)
    db.exec("insert into user (id, created_at, updated_at) values ('u1', 'x', 'x')");
    const r = migrate(db, { backupDir: backups });
    expect(r.applied).toEqual(["0003_ingest"]);
    const files = readdirSync(backups);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^narnia-pre-0003_ingest-.*\.sqlite$/);
    const copy = openDatabase(join(backups, files[0] as string));
    expect(copy.prepare("select value_json from settings where key = 'marcador'").get()).toEqual({
      value_json: '"ok"',
    });
    copy.close();
    db.close();
  });

  it("banco com migrations mas sem dados de usuário não gera backup pré-migration (F03-fix L1)", () => {
    dir = mkdtempSync(join(tmpdir(), "narnia-mig-"));
    const backups = join(dir, "backups");
    const db = openDatabase(join(dir, "narnia.sqlite"));
    migrate(db, { until: "0002_profiles" });
    migrate(db, { backupDir: backups });
    expect(existsSync(backups) ? readdirSync(backups) : []).toEqual([]);
    db.close();
  });

  it("banco novo e banco em dia não geram backup", () => {
    dir = mkdtempSync(join(tmpdir(), "narnia-mig-"));
    const backups = join(dir, "backups");
    const db = openDatabase(join(dir, "narnia.sqlite"));
    migrate(db, { backupDir: backups });
    migrate(db, { backupDir: backups });
    expect(existsSync(backups) ? readdirSync(backups) : []).toEqual([]);
    db.close();
  });

  it("mantém só os 5 backups mais recentes", () => {
    dir = mkdtempSync(join(tmpdir(), "narnia-mig-"));
    const backups = join(dir, "backups");
    const db = openDatabase(join(dir, "narnia.sqlite"));
    migrate(db, { until: "0002_profiles" });
    db.exec("insert into user (id, created_at, updated_at) values ('u1', 'x', 'x')");
    mkdirSync(backups, { recursive: true });
    for (let i = 0; i < 6; i++)
      writeFileSync(join(backups, `narnia-pre-0000_x-2026-01-0${i}T00-00-00Z.sqlite`), "");
    migrate(db, { backupDir: backups });
    const files = readdirSync(backups).sort();
    expect(files).toHaveLength(5);
    expect(files.some((f) => f.startsWith("narnia-pre-0003_ingest-"))).toBe(true);
    db.close();
  });
});
