import {
  generateDeviceToken,
  generatePairingCode,
  hashSecret,
  normalizePairingCode,
  PAIRING_TTL_MS,
} from "../../extension/pairing";
import { newId } from "../../ids";
import type { Db } from "../open";
import { type Row, str } from "../sql";

export interface ExtensionDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface ExtensionRepo {
  /** Gera um código novo e invalida os anteriores ainda não usados. */
  createPairing(now?: Date): { code: string; expiresAt: string };
  /** Código válido (não usado, não vencido) vira um dispositivo; devolve o token uma única vez. */
  pair(code: string, name: string, now?: Date): { token: string; device: ExtensionDevice } | null;
  findByToken(token: string): ExtensionDevice | null;
  listDevices(): ExtensionDevice[];
  revoke(id: string, now?: Date): boolean;
  /** Último uso, gravado no máximo uma vez por minuto. */
  touch(id: string, now?: Date): void;
}

const TOUCH_EVERY_MS = 60 * 1000;

function map(r: Row): ExtensionDevice {
  return {
    id: String(r.id),
    name: String(r.name),
    createdAt: String(r.created_at),
    lastSeenAt: str(r.last_seen_at),
  };
}

function lazy(db: Db) {
  const cache = new Map<string, ReturnType<Db["prepare"]>>();
  return (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
}

function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec("begin");
  try {
    const out = fn();
    db.exec("commit");
    return out;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}

export function extensionRepo(db: Db): ExtensionRepo {
  const q = lazy(db);
  const byId = (id: string) =>
    q("select * from extension_device where id = ?").get(id) as Row | undefined;

  return {
    createPairing(now = new Date()) {
      const code = generatePairingCode();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
      inTransaction(db, () => {
        q("update extension_pairing set used_at = ? where used_at is null").run(createdAt);
        q("insert into extension_pairing (code_hash, created_at, expires_at) values (?, ?, ?)").run(
          hashSecret(normalizePairingCode(code)),
          createdAt,
          expiresAt,
        );
      });
      return { code, expiresAt };
    },
    pair(code, name, now = new Date()) {
      const at = now.toISOString();
      return inTransaction(db, () => {
        const used = q(
          `update extension_pairing set used_at = ?
           where code_hash = ? and used_at is null and expires_at > ?`,
        ).run(at, hashSecret(normalizePairingCode(code)), at);
        if (Number(used.changes) === 0) return null;
        const token = generateDeviceToken();
        const id = newId();
        q(
          "insert into extension_device (id, name, token_hash, created_at) values (?, ?, ?, ?)",
        ).run(id, name.trim().slice(0, 80) || "Chrome", hashSecret(token), at);
        return { token, device: map(byId(id) as Row) };
      });
    },
    findByToken(token) {
      const row = q(
        "select * from extension_device where token_hash = ? and revoked_at is null",
      ).get(hashSecret(token)) as Row | undefined;
      return row ? map(row) : null;
    },
    listDevices() {
      return (
        q(
          "select * from extension_device where revoked_at is null order by created_at, id",
        ).all() as Row[]
      ).map(map);
    },
    revoke(id, now = new Date()) {
      const r = q(
        "update extension_device set revoked_at = ? where id = ? and revoked_at is null",
      ).run(now.toISOString(), id);
      return Number(r.changes) > 0;
    },
    touch(id, now = new Date()) {
      q(
        `update extension_device set last_seen_at = ?
         where id = ? and (last_seen_at is null or last_seen_at <= ?)`,
      ).run(now.toISOString(), id, new Date(now.getTime() - TOUCH_EVERY_MS).toISOString());
    },
  };
}
