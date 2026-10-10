import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../../src/db";
import { type GhClient, GhError } from "../../../src/ingest/sources/github/gh";
import { withSnapshots } from "../../../src/ingest/sources/github/snapshot";

/** Plano de correções F03, item 14: um arquivo por resposta, sem regravar nem reler o escopo. */
const REPO = "ana-exemplo/api-pagamentos";

function stub(online: { value: boolean }): GhClient {
  const answer = async (path: string) => {
    if (!online.value) throw new GhError("unavailable", "sem rede");
    return { path, body: "x".repeat(200) };
  };
  return {
    json: answer as GhClient["json"],
    raw: async (p) => JSON.stringify(await answer(p)),
    tryJson: answer as GhClient["tryJson"],
    tryRaw: async (p) => JSON.stringify(await answer(p)),
    graphql: (async () => ({})) as GhClient["graphql"],
  };
}

describe("F03 fix L3 · item 14: snapshots incrementais", () => {
  let dataDir: string;
  let repos: Repos;
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("100 respostas → 100 arquivos pequenos no diretório do escopo; um registro por escopo com o tamanho somado", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "narnia-snap-"));
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    const online = { value: true };
    const gh = withSnapshots(stub(online), { dataDir, repos });
    for (let i = 0; i < 100; i++) await gh.json(`repos/${REPO}/contents/f${i}.ts`);
    const scopeDir = join(dataDir, "snapshots", "github", "ana-exemplo__api-pagamentos");
    const files = readdirSync(scopeDir);
    expect(files).toHaveLength(100);
    const sizes = files.map((f) => statSync(join(scopeDir, f)).size);
    expect(Math.max(...sizes)).toBeLessThan(1_000);
    const snaps = repos.snapshots.list().filter((s) => s.ref === REPO);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.size).toBe(sizes.reduce((a, b) => a + b, 0));

    online.value = false;
    expect(await gh.json<{ path: string }>(`repos/${REPO}/contents/f42.ts`)).toMatchObject({
      path: `repos/${REPO}/contents/f42.ts`,
    });
  });
});
