import { describe, expect, it } from "vitest";
import { createRepos, listMigrations, migrate, openDatabase } from "../../src/db";

const T = "2026-10-08T12:00:00.000Z";

/** Banco no estado do F02 (0001 + 0002) com dados reais de F01/F02, populado só com SQL (os repos já são F03). */
function f02Database() {
  const db = openDatabase(":memory:");
  const r = migrate(db, { until: "0002_profiles" });
  expect(r.applied).toEqual(["0001_init", "0002_profiles"]);
  db.exec(`
    insert into user (id, full_name, created_at, updated_at) values ('u1', 'Ana Maria Exemplo', '${T}', '${T}');
    insert into source_file (id, original_name, mime, size, sha256, path, kind, uploaded_at)
      values ('f1', 'cv.pdf', 'application/pdf', 10, 'abc', 'uploads/abc.pdf', 'cv', '${T}');
    insert into ingestion_run (id, file_id, provider, models_json, options_json, depth, status, estimate_json, usage_json, created_at, started_at, finished_at)
      values ('run1', 'f1', 'claude-code', '{"document":"h","facts":"h","digest":"s"}', '{"ocr":true,"modelRead":true}', 'quick', 'done', '{"documentTokens":1}', '{"facts":{"inputTokens":1,"outputTokens":2}}', '${T}', '${T}', '${T}');
    insert into reading (id, run_id, kind, text_path, quality, created_at) values ('rd1', 'run1', 'text_layer', 'readings/run1/t.txt', 0.9, '${T}');
    insert into reading_segment (id, run_id, idx, text, origin, agreement) values ('sg1', 'run1', 0, 'Acme', 'text_layer', 1);
    insert into ingestion_proposal (id, run_id, idx, kind, payload_json, confidence, decision)
      values ('p1', 'run1', 0, 'skill', '{"kind":"skill","confidence":0.9,"data":{"name":"React","category":"framework"}}', 0.9, 'accepted');
    insert into fact_source (id, kind, file_id, run_id, created_at) values ('fs1', 'cv', 'f1', 'run1', '${T}');
    insert into experience (id, user_id, company, title, start_date, is_current, tech_json, source_id, confidence, verified, created_at, updated_at)
      values ('e1', 'u1', 'Acme', 'Dev', '2020-01', 1, '[]', 'fs1', 0.9, 1, '${T}', '${T}');
  `);
  return db;
}

describe("F03/M1 migration 0003_ingest", () => {
  it("é aplicada depois de 0002 e cria as tabelas novas", () => {
    expect(listMigrations().map((m) => m.name)).toContain("0003_ingest");
    const db = openDatabase(":memory:");
    migrate(db);
    const tables = (
      db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((t) => t.name);
    for (const t of [
      "repo",
      "repo_analysis",
      "repo_digest",
      "github_metric",
      "snapshot",
      "notification",
    ])
      expect(tables).toContain(t);
  });

  it("upgrade de um banco do F02 preserva execução, leituras, propostas, fontes e fatos", () => {
    const db = f02Database();
    expect(migrate(db).applied).toEqual(["0003_ingest"]);
    const run = db.prepare("select * from ingestion_run where id = 'run1'").get() as Record<
      string,
      unknown
    >;
    expect(run).toMatchObject({
      file_id: "f1",
      status: "done",
      source: "cv",
      depth: "quick",
      mode: null,
    });
    expect(String(run.usage_json)).toContain("outputTokens");
    expect(db.prepare("select count(*) n from reading").get()).toEqual({ n: 1 });
    expect(db.prepare("select count(*) n from reading_segment").get()).toEqual({ n: 1 });
    expect(db.prepare("select decision from ingestion_proposal where id = 'p1'").get()).toEqual({
      decision: "accepted",
    });
    expect(db.prepare("select run_id from fact_source where id = 'fs1'").get()).toEqual({
      run_id: "run1",
    });
    expect(db.prepare("select source_id from experience where id = 'e1'").get()).toEqual({
      source_id: "fs1",
    });
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
    expect(db.prepare("pragma foreign_keys").get()).toEqual({ foreign_keys: 1 });
    // os repos do F03 funcionam sobre o banco migrado
    const repos = createRepos(db);
    expect(repos.ingestionRuns.get("run1")?.source).toBe("cv");
  });

  it("chaves estrangeiras continuam valendo depois da reconstrução", () => {
    const db = f02Database();
    migrate(db);
    expect(() =>
      db.exec(
        `insert into reading (id, run_id, kind, text_path, quality, created_at) values ('x', 'nope', 'ocr', 'p', 1, '${T}')`,
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("file_id nulo só para GitHub; estados novos aceitos; estado desconhecido recusado", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const ins = (id: string, file: string | null, source: string, status: string) =>
      db
        .prepare(
          "insert into ingestion_run (id, file_id, source, provider, models_json, options_json, status, created_at) values (?, ?, ?, 'x', '{}', '{}', ?, ?)",
        )
        .run(id, file, source, status, T);
    expect(() => ins("g1", null, "github", "awaiting_decision")).not.toThrow();
    for (const s of ["awaiting_confirmation", "paused", "cancelled"])
      expect(() => ins(`g-${s}`, null, "github", s)).not.toThrow();
    expect(() => ins("c1", null, "cv", "queued")).toThrow(/CHECK/);
    expect(() => ins("g2", null, "github", "sleeping")).toThrow(/CHECK/);
  });

  it("migration recusa banco com referência órfã (foreign_key_check antes do commit) e religa as FKs", () => {
    const db = f02Database();
    db.exec("pragma foreign_keys = off");
    db.exec(
      `insert into reading (id, run_id, kind, text_path, quality, created_at) values ('orf', 'missing', 'ocr', 'p', 1, '${T}')`,
    );
    db.exec("pragma foreign_keys = on");
    expect(() => migrate(db)).toThrow(/foreign_key_check/);
    expect(
      db.prepare("select count(*) n from schema_migrations where name = '0003_ingest'").get(),
    ).toEqual({ n: 0 });
    expect(db.prepare("pragma foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });
});
