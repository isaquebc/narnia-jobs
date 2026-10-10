import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepos, migrate, openDatabase } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { bootData, DATABASE_SUBJECT_ID } from "../src/boot";
import { runDoctor } from "../src/doctor";
import { makeTestApp, type TestApp } from "./helpers";

/** F03-fix L1 (incidente de 2026-10-10): itens 1, 2, 3 e 5 do lado da api. */
const roots: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  roots.push(d);
  return d;
};
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("F03-fix L1 · boot: backup e banco recriado", () => {
  it("banco com dados: cria o backup do dia fora da pasta de dados e resolve aviso antigo de banco recriado", () => {
    const root = tmp("narnia-boot-");
    const dataDir = join(root, "data");
    const backupDir = join(root, "backups");
    mkdirSync(dataDir);
    const db = openDatabase(join(dataDir, "narnia.sqlite"));
    migrate(db);
    const repos = createRepos(db);
    repos.notifications.upsert({
      kind: "data.recreated",
      subjectKind: "database",
      subjectId: DATABASE_SUBJECT_ID,
      title: "x",
      actionUrl: "/configuracoes",
      severity: "error",
    });
    db.exec("insert into user (id, created_at, updated_at) values ('u1', 'x', 'x')");
    const r = bootData({ db, repos, dataDir, backupDir, now: new Date("2026-10-10T08:00:00Z") });
    expect(r.backup.created).toMatch(/narnia-boot-2026-10-10/);
    expect(readdirSync(backupDir).some((f) => f.startsWith("narnia-boot-"))).toBe(true);
    expect(existsSync(join(dataDir, "backups"))).toBe(false);
    expect(
      repos.notifications.list({ status: "open" }).filter((n) => n.kind === "data.recreated"),
    ).toEqual([]);
    db.close();
  });

  it("banco vazio com backup anterior: notificação crítica com o arquivo e o comando de restauração", () => {
    const root = tmp("narnia-boot-");
    const dataDir = join(root, "data");
    const backupDir = join(root, "backups");
    mkdirSync(dataDir);
    mkdirSync(backupDir);
    writeFileSync(join(backupDir, "narnia-boot-2026-10-09T08-00-00-000Z.sqlite"), "");
    const db = openDatabase(join(dataDir, "narnia.sqlite"));
    migrate(db);
    const repos = createRepos(db);
    const r = bootData({ db, repos, dataDir, backupDir });
    expect(r.fresh?.latestBackup?.file).toBe("narnia-boot-2026-10-09T08-00-00-000Z.sqlite");
    const [n] = repos.notifications.list({ status: "open" });
    expect(n).toMatchObject({ kind: "data.recreated", severity: "error" });
    expect(n?.body).toContain("narnia-boot-2026-10-09T08-00-00-000Z.sqlite");
    expect(n?.body).toContain("./start.sh restore");
    // segundo boot não duplica
    bootData({ db, repos, dataDir, backupDir });
    expect(repos.notifications.list({ status: "open" })).toHaveLength(1);
    db.close();
  });

  it("falha de backup não derruba o boot", () => {
    const root = tmp("narnia-boot-");
    const dataDir = join(root, "data");
    mkdirSync(dataDir);
    writeFileSync(join(root, "arquivo"), "x");
    const db = openDatabase(join(dataDir, "narnia.sqlite"));
    migrate(db);
    db.exec("insert into user (id, created_at, updated_at) values ('u1', 'x', 'x')");
    const repos = createRepos(db);
    const logs: string[] = [];
    const r = bootData({
      db,
      repos,
      dataDir,
      backupDir: join(root, "arquivo", "sub"),
      log: (m) => logs.push(m),
    });
    expect(r.backup.error).toBeTruthy();
    expect(logs.join(" ")).toContain("backup");
    db.close();
  });
});

describe("F03-fix L1 · configuração de backups", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET devolve o teto (padrão 5); PUT grava; mínimo 1", async () => {
    t = makeTestApp();
    expect(await (await t.api("/api/settings/backups")).json()).toMatchObject({ max: 5 });
    const put = await t.api("/api/settings/backups", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ max: 3 }),
    });
    expect(put.status).toBe(200);
    expect(await (await t.api("/api/settings/backups")).json()).toMatchObject({ max: 3 });
    const bad = await t.api("/api/settings/backups", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ max: 0 }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("F03-fix L1 · guarda estrita do DELETE de snapshots (item 3)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it.each([
    ["a própria pasta de dados (absoluta)", (d: string) => d],
    ['"."', () => "."],
    ['"snapshots"', () => "snapshots"],
    ['"../x"', () => "../x"],
  ])("caminho %s → 400 e nada removido", async (_label, pathOf) => {
    t = makeTestApp();
    writeFileSync(join(t.dataDir, "precioso.txt"), "não apague");
    mkdirSync(join(t.dataDir, "snapshots"), { recursive: true });
    const snap = t.repos.snapshots.create({
      source: "github",
      ref: "x/y",
      headSha: null,
      path: pathOf(t.dataDir),
      sha256: "0",
      size: 0,
    } as never);
    const res = await t.api(`/api/snapshots/${snap.id}`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(existsSync(join(t.dataDir, "precioso.txt"))).toBe(true);
    expect(existsSync(join(t.dataDir, "snapshots"))).toBe(true);
    expect(t.repos.snapshots.get(snap.id)).not.toBeNull();
  });

  it("link simbólico para fora da pasta → 400; caminho válido dentro de snapshots/ → removido", async () => {
    t = makeTestApp();
    const outside = tmp("narnia-out-");
    writeFileSync(join(outside, "alvo.txt"), "x");
    mkdirSync(join(t.dataDir, "snapshots", "github"), { recursive: true });
    symlinkSync(outside, join(t.dataDir, "snapshots", "github", "link"));
    const bad = t.repos.snapshots.create({
      source: "github",
      ref: "x/y",
      headSha: null,
      path: "snapshots/github/link",
      sha256: "0",
      size: 0,
    } as never);
    expect((await t.api(`/api/snapshots/${bad.id}`, { method: "DELETE" })).status).toBe(400);
    expect(existsSync(join(outside, "alvo.txt"))).toBe(true);

    mkdirSync(join(t.dataDir, "snapshots", "github", "ok"), { recursive: true });
    const good = t.repos.snapshots.create({
      source: "github",
      ref: "x/z",
      headSha: null,
      path: "snapshots/github/ok",
      sha256: "0",
      size: 0,
    } as never);
    expect((await t.api(`/api/snapshots/${good.id}`, { method: "DELETE" })).status).toBe(200);
    expect(existsSync(join(t.dataDir, "snapshots", "github", "ok"))).toBe(false);
  });
});

describe("F03-fix L1 · doctor (item 5)", () => {
  it("acusa banco apagado mantido aberto por processo, mostra tamanhos, último backup e última requisição", async () => {
    const root = tmp("narnia-doc-");
    const dataDir = join(root, "data");
    const proc = join(root, "proc");
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    writeFileSync(join(dataDir, "narnia.sqlite"), "x".repeat(10));
    writeFileSync(join(dataDir, "narnia.sqlite-wal"), "x".repeat(4));
    writeFileSync(
      join(dataDir, "logs", "api-2026-10-10.jsonl"),
      '{"ts":"2026-10-10T11:15:38.629Z"}\n{"ts":"2026-10-10T11:15:40.000Z"}\n',
    );
    mkdirSync(join(proc, "123", "fd"), { recursive: true });
    symlinkSync("/app/data/narnia.sqlite (deleted)", join(proc, "123", "fd", "7"));
    const r = await runDoctor({
      provider: new MockProvider(),
      dataDir,
      redisPing: async () => "PONG",
      workerHeartbeat: async () => new Date().toISOString(),
      backupDir: join(root, "sem-backups"),
      procRoot: proc,
    });
    expect(r.checks.database).toMatchObject({ sizeBytes: 10, walBytes: 4 });
    expect(r.checks.deletedOpen).toEqual([{ pid: 123, fd: "7" }]);
    expect(r.checks.lastRequest).toBe("2026-10-10T11:15:40.000Z");
    expect(r.checks.lastBackup).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.hints.join(" ")).toContain("/proc/123/fd/7");
    expect(r.hints.join(" ")).toMatch(/backup/i);
  });
});
