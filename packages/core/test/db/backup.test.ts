import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupOnBoot,
  type Db,
  DEFAULT_BACKUPS_MAX,
  detectFreshDatabase,
  hasUserData,
  migrate,
  openDatabase,
  pruneBackups,
  readBackupsMax,
  resolveBackupDir,
} from "../../src/db";

/**
 * F03-fix L1 item 1 e 2 (incidente de 2026-10-10: banco do dono recriado do zero, sem cópia): backup no boot, fora
 * da pasta de dados, no máximo um por dia, poda única de `backups.max` (padrão 5, FX-2), uploads por sha, e detecção
 * de banco vazio com histórico.
 */
const DAY1 = new Date("2026-10-10T08:00:00.000Z");
const DAY1_LATER = new Date("2026-10-10T20:00:00.000Z");
const DAY2 = new Date("2026-10-11T08:00:00.000Z");

function withUser(db: Db) {
  db.prepare("insert into user (id, created_at, updated_at) values ('u1', ?, ?)").run(
    DAY1.toISOString(),
    DAY1.toISOString(),
  );
}

const sqliteFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".sqlite"))
        .sort()
    : [];

describe("backup no boot e poda (F03-fix L1)", () => {
  let root: string;
  let dataDir: string;
  let backupDir: string;
  let db: Db;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "narnia-bkp-"));
    dataDir = join(root, "data");
    backupDir = join(root, "backups");
    mkdirSync(dataDir, { recursive: true });
    db = openDatabase(join(dataDir, "narnia.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("cria um backup no primeiro boot do dia, nenhum no segundo e outro no dia seguinte", () => {
    withUser(db);
    const r1 = backupOnBoot({ db, dataDir, backupDir, now: DAY1 });
    expect(r1.created).toMatch(/narnia-boot-2026-10-10T08-00-00-000Z\.sqlite$/);
    expect(backupOnBoot({ db, dataDir, backupDir, now: DAY1_LATER })).toMatchObject({
      created: null,
      skipped: "already_today",
    });
    expect(backupOnBoot({ db, dataDir, backupDir, now: DAY2 }).created).not.toBeNull();
    expect(sqliteFiles(backupDir)).toHaveLength(2);
    const copy = openDatabase(join(backupDir, sqliteFiles(backupDir)[0] as string));
    expect(copy.prepare("select id from user").get()).toEqual({ id: "u1" });
    copy.close();
  });

  it("banco sem dados de usuário não gera backup (nunca empurra cópias boas para fora com cópias vazias)", () => {
    expect(backupOnBoot({ db, dataDir, backupDir, now: DAY1 })).toMatchObject({
      created: null,
      skipped: "empty",
    });
    expect(sqliteFiles(backupDir)).toEqual([]);
  });

  it("pasta desligada (null) não faz nada; erro de escrita vira aviso e não lança", () => {
    withUser(db);
    expect(backupOnBoot({ db, dataDir, backupDir: null, now: DAY1 })).toMatchObject({
      skipped: "disabled",
    });
    const blocker = join(root, "arquivo");
    writeFileSync(blocker, "x");
    const r = backupOnBoot({ db, dataDir, backupDir: join(blocker, "sub"), now: DAY1 });
    expect(r.created).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it("poda única: no máximo backups.max no total (boot e pré-migration juntos), sai o mais antigo", () => {
    withUser(db);
    mkdirSync(backupDir, { recursive: true });
    const names = [
      "narnia-boot-2026-10-01T08-00-00-000Z.sqlite",
      "narnia-pre-0003_ingest-2026-10-02T08-00-00-000Z.sqlite",
      "narnia-boot-2026-10-03T08-00-00-000Z.sqlite",
      "narnia-boot-2026-10-04T08-00-00-000Z.sqlite",
      "narnia-boot-2026-10-05T08-00-00-000Z.sqlite",
    ];
    names.forEach((n, i) => {
      writeFileSync(join(backupDir, n), "");
      const t = new Date(`2026-10-0${i + 1}T08:00:00Z`);
      utimesSync(join(backupDir, n), t, t);
    });
    writeFileSync(join(backupDir, "outro-arquivo.sqlite"), ""); // não é nosso: nunca é apagado
    writeFileSync(join(backupDir, "narnia-before-restore-2026-09-01T00-00-00-000Z.sqlite"), "");
    backupOnBoot({ db, dataDir, backupDir, now: DAY1, max: 5 });
    const ours = sqliteFiles(backupDir).filter((f) => /^narnia-(boot|pre-)/.test(f));
    expect(ours).toHaveLength(5);
    expect(ours).not.toContain(names[0]);
    expect(sqliteFiles(backupDir)).toContain("outro-arquivo.sqlite");
    expect(sqliteFiles(backupDir)).toContain(
      "narnia-before-restore-2026-09-01T00-00-00-000Z.sqlite",
    );
    expect(pruneBackups(backupDir, 2)).toHaveLength(3);
  });

  it("backups.max vem de settings (padrão 5, mínimo 1) e vale na próxima poda", () => {
    expect(readBackupsMax(db)).toBe(DEFAULT_BACKUPS_MAX);
    db.prepare("insert into settings (key, value_json) values ('backups.max', '2')").run();
    expect(readBackupsMax(db)).toBe(2);
    db.prepare("update settings set value_json = '0' where key = 'backups.max'").run();
    expect(readBackupsMax(db)).toBe(1);
  });

  it("copia os uploads por sha para <backups>/uploads, só os que faltam", () => {
    withUser(db);
    mkdirSync(join(dataDir, "uploads"));
    writeFileSync(join(dataDir, "uploads", "aaa.pdf"), "cv");
    backupOnBoot({ db, dataDir, backupDir, now: DAY1 });
    expect(readdirSync(join(backupDir, "uploads"))).toEqual(["aaa.pdf"]);
    writeFileSync(join(dataDir, "uploads", "bbb.docx"), "cv2");
    const r = backupOnBoot({ db, dataDir, backupDir, now: DAY2 });
    expect(r.uploadsCopied).toBe(1);
    expect(readdirSync(join(backupDir, "uploads")).sort()).toEqual(["aaa.pdf", "bbb.docx"]);
  });

  it("resolveBackupDir: env vazio cai em <dados>/backups (instância antiga), 'off' desliga, valor explícito vale", () => {
    expect(resolveBackupDir({}, "/data")).toBe("/data/backups");
    expect(resolveBackupDir({ NARNIA_BACKUP_DIR: "off" }, "/data")).toBeNull();
    expect(resolveBackupDir({ NARNIA_BACKUP_DIR: "/backups" }, "/data")).toBe("/backups");
  });
});

describe("detecção de banco recriado (F03-fix L1 item 2)", () => {
  let root: string;
  let db: Db;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "narnia-fresh-"));
    db = openDatabase(join(root, "narnia.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("banco vazio + backups → devolve o backup mais recente", () => {
    const backups = join(root, "backups");
    mkdirSync(backups);
    writeFileSync(join(backups, "narnia-boot-2026-10-09T08-00-00-000Z.sqlite"), "");
    writeFileSync(join(backups, "narnia-boot-2026-10-10T08-00-00-000Z.sqlite"), "");
    utimesSync(join(backups, "narnia-boot-2026-10-09T08-00-00-000Z.sqlite"), DAY1, DAY1);
    utimesSync(join(backups, "narnia-boot-2026-10-10T08-00-00-000Z.sqlite"), DAY2, DAY2);
    const r = detectFreshDatabase({ db, backupDir: backups, logsDir: join(root, "logs") });
    expect(r?.latestBackup?.file).toBe("narnia-boot-2026-10-10T08-00-00-000Z.sqlite");
  });

  it("banco vazio sem backups mas com logs de requisições → histórico sem backup", () => {
    mkdirSync(join(root, "logs"));
    writeFileSync(join(root, "logs", "api-2026-10-09.jsonl"), '{"ts":"x"}\n');
    expect(detectFreshDatabase({ db, backupDir: null, logsDir: join(root, "logs") })).toEqual({
      latestBackup: null,
      hasLogs: true,
    });
  });

  it("banco com dados ou sem histórico nenhum → nada", () => {
    expect(
      detectFreshDatabase({ db, backupDir: join(root, "nada"), logsDir: join(root, "nada") }),
    ).toBeNull();
    withUser(db);
    mkdirSync(join(root, "logs"));
    writeFileSync(join(root, "logs", "api-2026-10-09.jsonl"), "{}\n");
    expect(hasUserData(db)).toBe(true);
    expect(detectFreshDatabase({ db, backupDir: null, logsDir: join(root, "logs") })).toBeNull();
  });
});

describe("F05/M7 · backup dos templates de CV enviados", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { backupTemplates } = await import("../../src/db/backup");

  it("copia só os .zip que faltam (a prévia é derivada)", () => {
    const data = mkdtempSync(join(tmpdir(), "narnia-tpl-data-"));
    const bk = mkdtempSync(join(tmpdir(), "narnia-tpl-bk-"));
    try {
      mkdirSync(join(data, "templates"));
      writeFileSync(join(data, "templates/t1.zip"), "zip");
      writeFileSync(join(data, "templates/t1.png"), "png");
      expect(backupTemplates(data, bk)).toBe(1);
      expect(existsSync(join(bk, "templates/t1.zip"))).toBe(true);
      expect(existsSync(join(bk, "templates/t1.png"))).toBe(false);
      expect(backupTemplates(data, bk)).toBe(0);
    } finally {
      rmSync(data, { recursive: true, force: true });
      rmSync(bk, { recursive: true, force: true });
    }
  });
});
