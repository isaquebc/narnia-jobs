import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repos } from "../../../db";
import { resolveIngestSettings } from "../../settings";
import { syncSnapshotCapNotification } from "../../snapshot-cap";
import { type GhClient, GhError } from "./gh";

/**
 * Snapshots do GitHub (F03 §3, F03-9, §6.3 E2E-11): toda resposta bem-sucedida do `gh` é gravada num arquivo por
 * escopo (o repositório, ou `_global` para usuário/organizações, ou `_graphql`) em `<dataDir>/snapshots/github/`, com
 * um registro em `snapshot` (tamanho, sha256). Quando o GitHub está inacessível (`GhError` `unavailable`), a mesma
 * chamada é respondida pelo snapshot, que fica marcado como usado. Erros que não são de rede (401, 404, rate limit)
 * nunca caem no snapshot: refletem o estado real da conta. Os snapshots só guardam o que já foi lido (metadados,
 * README, árvore, os arquivos escolhidos), nunca o token.
 */
const SOURCE = "github";

interface SnapshotFile {
  scope: string;
  entries: Record<string, unknown>;
}

export function snapshotScope(key: string): string {
  if (key.startsWith("graphql:")) return "_graphql";
  const m = /^(?:json|raw|tryJson|tryRaw):repos\/([^/?#]+\/[^/?#]+)/.exec(key);
  return m ? (m[1] as string) : "_global";
}

const scopeDirName = (scope: string) => scope.replace(/[^\w.-]/g, "__");

export function withSnapshots(gh: GhClient, o: { dataDir: string; repos: Repos }): GhClient {
  const dir = join(o.dataDir, "snapshots", SOURCE);
  const scopeDirOf = (scope: string) => join(dir, scopeDirName(scope));
  const entryFile = (key: string) => `${createHash("sha1").update(key).digest("hex")}.json`;
  /** Índice em memória por escopo (correções F03, item 14): registro, tamanho somado e tamanho de cada chave. */
  const index = new Map<string, { id: string; size: number; entries: Map<string, number> }>();

  const indexOf = (scope: string) => {
    let entry = index.get(scope);
    if (!entry) {
      const existing = o.repos.snapshots.list().find((s) => s.source === SOURCE && s.ref === scope);
      const id =
        existing?.id ??
        o.repos.snapshots.create({
          source: SOURCE,
          ref: scope,
          headSha: null,
          path: scopeDirOf(scope),
          sha256: createHash("sha256").update(scope).digest("hex"),
          size: 0,
        }).id;
      entry = { id, size: existing?.size ?? 0, entries: new Map() };
      index.set(scope, entry);
    }
    return entry;
  };

  /** Um arquivo pequeno por resposta (chave = hash da requisição); nunca relê nem regrava o escopo inteiro. */
  const record = (key: string, value: unknown) => {
    const scope = snapshotScope(key);
    const scopeDir = scopeDirOf(scope);
    mkdirSync(scopeDir, { recursive: true });
    const text = JSON.stringify({ key, value });
    writeFileSync(join(scopeDir, entryFile(key)), text, { encoding: "utf8", mode: 0o600 });
    const entry = indexOf(scope);
    const bytes = Buffer.byteLength(text);
    entry.size += bytes - (entry.entries.get(key) ?? 0);
    entry.entries.set(key, bytes);
    o.repos.snapshots.setSize(
      entry.id,
      entry.size,
      createHash("sha256").update(`${scope}:${entry.entries.size}:${entry.size}`).digest("hex"),
    );
    // passou do teto: o aviso nasce aqui; a api o retransmite na próxima leitura (correções F03, item 15)
    syncSnapshotCapNotification(o.repos, resolveIngestSettings(o.repos.settings).snapshotsMaxBytes);
  };

  const replay = (key: string): { hit: true; value: unknown } | { hit: false } => {
    const scope = snapshotScope(key);
    const file = join(scopeDirOf(scope), entryFile(key));
    let found: { hit: true; value: unknown } | { hit: false } = { hit: false };
    if (existsSync(file)) {
      try {
        found = {
          hit: true,
          value: (JSON.parse(readFileSync(file, "utf8")) as { value: unknown }).value,
        };
      } catch {
        found = { hit: false };
      }
    } else {
      // formato antigo (um arquivo JSON por escopo), ainda aceito na leitura
      const legacy = join(dir, `${scopeDirName(scope)}.json`);
      if (existsSync(legacy)) {
        try {
          const f = JSON.parse(readFileSync(legacy, "utf8")) as SnapshotFile;
          if (key in f.entries) found = { hit: true, value: f.entries[key] };
        } catch {
          found = { hit: false };
        }
      }
    }
    if (found.hit) {
      const snap = o.repos.snapshots.list().find((s) => s.source === SOURCE && s.ref === scope);
      if (snap) o.repos.snapshots.touch(snap.id);
    }
    return found;
  };

  async function through<T>(key: string, call: () => Promise<T>): Promise<T> {
    try {
      const value = await call();
      record(key, value);
      return value;
    } catch (e) {
      if (e instanceof GhError && e.code === "unavailable") {
        const r = replay(key);
        if (r.hit) return r.value as T;
      }
      throw e;
    }
  }

  const page = (opts?: { paginate?: boolean }) => (opts?.paginate ? "#p" : "");
  return {
    json: <T>(path: string, opts?: { paginate?: boolean }) =>
      through<T>(`json:${path}${page(opts)}`, () => gh.json<T>(path, opts)),
    raw: (path: string) => through(`raw:${path}`, () => gh.raw(path)),
    tryJson: <T>(path: string, opts?: { paginate?: boolean }) =>
      through<T | null>(`tryJson:${path}${page(opts)}`, () => gh.tryJson<T>(path, opts)),
    tryRaw: (path: string) => through(`tryRaw:${path}`, () => gh.tryRaw(path)),
    graphql: <T>(query: string, variables?: Record<string, string>) =>
      through<T>(
        `graphql:${createHash("sha1")
          .update(query + JSON.stringify(variables ?? {}))
          .digest("hex")}`,
        () => gh.graphql<T>(query, variables),
      ),
  };
}
