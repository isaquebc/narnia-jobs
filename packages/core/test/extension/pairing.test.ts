import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  generatePairingCode,
  normalizePairingCode,
  PAIRING_TTL_MS,
} from "../../src/extension/pairing";

/**
 * F12/M1 (F12-4, F12-9) · pareamento da extensão: código curto de uso único (10 min) mostrado em Configurações vira um
 * token de dispositivo persistente e revogável; o banco guarda só os hashes.
 */
const at = (iso: string) => new Date(iso);

function repos() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

describe("F12/M1 · código de pareamento", () => {
  it("8 caracteres sem 0/O/1/I, mostrado como XXXX-XXXX", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePairingCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("normaliza o que a pessoa digita (minúsculas, espaço, hífen)", () => {
    expect(normalizePairingCode(" k7qm-3xpa ")).toBe("K7QM3XPA");
    expect(normalizePairingCode("K7QM 3XPA")).toBe("K7QM3XPA");
  });
});

describe("F12/M1 · repositório da extensão", () => {
  it("código vira token de dispositivo; o banco guarda só hashes", () => {
    const r = repos();
    const { code, expiresAt } = r.extension.createPairing(at("2026-10-22T10:00:00Z"));
    expect(Date.parse(expiresAt) - Date.parse("2026-10-22T10:00:00Z")).toBe(PAIRING_TTL_MS);
    const paired = r.extension.pair(
      code.toLowerCase(),
      "Chrome do notebook",
      at("2026-10-22T10:05:00Z"),
    );
    expect(paired?.token).toMatch(/^nxd_[0-9a-f]{64}$/);
    expect(paired?.device).toMatchObject({ name: "Chrome do notebook", lastSeenAt: null });
    const raw = JSON.stringify(r.db.prepare("select * from extension_device").all());
    expect(raw).not.toContain(paired?.token ?? "x");
    const pairings = JSON.stringify(r.db.prepare("select * from extension_pairing").all());
    expect(pairings).not.toContain(normalizePairingCode(code));
    expect(r.extension.findByToken(paired?.token ?? "")?.id).toBe(paired?.device.id);
  });

  it("código de uso único, vencido em 10 min, e um código novo invalida o anterior", () => {
    const r = repos();
    const first = r.extension.createPairing(at("2026-10-22T10:00:00Z"));
    expect(r.extension.pair(first.code, "a", at("2026-10-22T10:10:01Z"))).toBeNull();
    const second = r.extension.createPairing(at("2026-10-22T10:11:00Z"));
    const third = r.extension.createPairing(at("2026-10-22T10:12:00Z"));
    expect(r.extension.pair(second.code, "a", at("2026-10-22T10:12:30Z"))).toBeNull();
    expect(r.extension.pair(third.code, "a", at("2026-10-22T10:13:00Z"))).not.toBeNull();
    expect(r.extension.pair(third.code, "b", at("2026-10-22T10:13:10Z"))).toBeNull();
    expect(r.extension.pair("errado", "b", at("2026-10-22T10:13:10Z"))).toBeNull();
  });

  it("lista os dispositivos ativos; revogar derruba o token na hora", () => {
    const r = repos();
    const a = r.extension.pair(r.extension.createPairing().code, "Chrome A");
    const b = r.extension.pair(r.extension.createPairing().code, "Chrome B");
    expect(r.extension.listDevices().map((d) => d.name)).toEqual(["Chrome A", "Chrome B"]);
    expect(r.extension.revoke(a?.device.id ?? "")).toBe(true);
    expect(r.extension.findByToken(a?.token ?? "")).toBeNull();
    expect(r.extension.findByToken(b?.token ?? "")).not.toBeNull();
    expect(r.extension.listDevices().map((d) => d.name)).toEqual(["Chrome B"]);
    expect(r.extension.revoke("nao-existe")).toBe(false);
  });

  it("último uso: grava no primeiro acesso e no máximo uma vez por minuto", () => {
    const r = repos();
    const p = r.extension.pair(r.extension.createPairing().code, "Chrome");
    const id = p?.device.id ?? "";
    r.extension.touch(id, at("2026-10-22T10:00:00Z"));
    r.extension.touch(id, at("2026-10-22T10:00:30Z"));
    expect(r.extension.listDevices()[0]?.lastSeenAt).toBe("2026-10-22T10:00:00.000Z");
    r.extension.touch(id, at("2026-10-22T10:01:01Z"));
    expect(r.extension.listDevices()[0]?.lastSeenAt).toBe("2026-10-22T10:01:01.000Z");
  });

  it("migração 0017 entra sobre um banco da versão anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0016_posting_contact_linkedin" });
    expect(migrate(db).applied).toEqual(["0017_extension"]);
    expect(createRepos(db).extension.listDevices()).toEqual([]);
  });
});
