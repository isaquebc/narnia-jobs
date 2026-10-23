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

/** Página lida pela extensão (F12/M2); `payload` é o que o extrator da F06 tirou dela. */
export interface ExtensionCaptureRecord {
  id: string;
  kind: "page";
  url: string;
  title: string | null;
  payload: unknown;
  deviceId: string | null;
  postingId: string | null;
  createdAt: string;
  /** "Salvar vaga" pediu a análise (F12/M2): ela abre quando a extração da vaga termina. */
  analysisRequestedAt: string | null;
  analysisSessionId: string | null;
  analysisError: string | null;
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
  createCapture(
    input: Pick<ExtensionCaptureRecord, "kind" | "url" | "title" | "payload" | "deviceId">,
    now?: Date,
  ): ExtensionCaptureRecord;
  getCapture(id: string): ExtensionCaptureRecord | null;
  linkCapturePosting(id: string, postingId: string): void;
  requestCaptureAnalysis(id: string, now?: Date): void;
  /** Conversa da análise aberta (limpa o erro) ou o erro ao abrir. */
  setCaptureAnalysis(id: string, result: { sessionId: string } | { error: string }): void;
  /** Capturas daquela vaga com análise pedida e ainda sem conversa. */
  capturesAwaitingAnalysis(postingId: string): ExtensionCaptureRecord[];
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

function mapCapture(r: Row): ExtensionCaptureRecord {
  return {
    id: String(r.id),
    kind: "page",
    url: String(r.url),
    title: str(r.title),
    payload: JSON.parse(String(r.payload_json)),
    deviceId: str(r.device_id),
    postingId: str(r.posting_id),
    createdAt: String(r.created_at),
    analysisRequestedAt: str(r.analysis_requested_at),
    analysisSessionId: str(r.analysis_session_id),
    analysisError: str(r.analysis_error),
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
    createCapture(input, now = new Date()) {
      const id = newId();
      q(
        `insert into extension_capture (id, kind, url, title, payload_json, device_id, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.kind,
        input.url,
        input.title,
        JSON.stringify(input.payload),
        input.deviceId,
        now.toISOString(),
      );
      return this.getCapture(id) as ExtensionCaptureRecord;
    },
    getCapture(id) {
      const row = q("select * from extension_capture where id = ?").get(id) as Row | undefined;
      return row ? mapCapture(row) : null;
    },
    linkCapturePosting(id, postingId) {
      q("update extension_capture set posting_id = ? where id = ?").run(postingId, id);
    },
    requestCaptureAnalysis(id, now = new Date()) {
      q("update extension_capture set analysis_requested_at = ? where id = ?").run(
        now.toISOString(),
        id,
      );
    },
    setCaptureAnalysis(id, result) {
      q(
        "update extension_capture set analysis_session_id = ?, analysis_error = ? where id = ?",
      ).run(
        "sessionId" in result ? result.sessionId : null,
        "error" in result ? result.error : null,
        id,
      );
    },
    capturesAwaitingAnalysis(postingId) {
      return (
        q(
          `select * from extension_capture where posting_id = ? and analysis_requested_at is not null
           and analysis_session_id is null and analysis_error is null order by created_at, id`,
        ).all(postingId) as Row[]
      ).map(mapCapture);
    },
  };
}
