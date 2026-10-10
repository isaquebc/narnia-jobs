import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repos } from "../../../db";
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

const fileName = (scope: string) => `${scope.replace(/[^\w.-]/g, "__")}.json`;

export function withSnapshots(gh: GhClient, o: { dataDir: string; repos: Repos }): GhClient {
  const dir = join(o.dataDir, "snapshots", SOURCE);
  const pathOf = (scope: string) => join(dir, fileName(scope));

  const read = (scope: string): SnapshotFile | null => {
    const f = pathOf(scope);
    if (!existsSync(f)) return null;
    try {
      return JSON.parse(readFileSync(f, "utf8")) as SnapshotFile;
    } catch {
      return null;
    }
  };

  const record = (key: string, value: unknown) => {
    const scope = snapshotScope(key);
    const file = read(scope) ?? { scope, entries: {} };
    file.entries[key] = value;
    mkdirSync(dir, { recursive: true });
    const text = JSON.stringify(file);
    const path = pathOf(scope);
    writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
    const existing = o.repos.snapshots.list().find((s) => s.source === SOURCE && s.ref === scope);
    if (existing) o.repos.snapshots.remove(existing.id);
    o.repos.snapshots.create({
      source: SOURCE,
      ref: scope,
      headSha: existing?.headSha ?? null,
      path,
      sha256: createHash("sha256").update(text).digest("hex"),
      size: Buffer.byteLength(text),
    });
  };

  const replay = (key: string): { hit: true; value: unknown } | { hit: false } => {
    const scope = snapshotScope(key);
    const file = read(scope);
    if (!file || !(key in file.entries)) return { hit: false };
    const snap = o.repos.snapshots.list().find((s) => s.source === SOURCE && s.ref === scope);
    if (snap) o.repos.snapshots.touch(snap.id);
    return { hit: true, value: file.entries[key] };
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
