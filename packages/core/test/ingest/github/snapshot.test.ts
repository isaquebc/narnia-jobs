import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../../src/db";
import { createGhClient, GhError } from "../../../src/ingest/sources/github/gh";
import { resolveGhRuntime } from "../../../src/ingest/sources/github/runtime";
import { withSnapshots } from "../../../src/ingest/sources/github/snapshot";
import { fakeGh } from "../../fixtures/github/fake-gh";

const REPO = "ana-exemplo/api-pagamentos";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-snap-"));
  const state: { offline?: boolean } = {};
  const fake = fakeGh({ state });
  const gh = withSnapshots(createGhClient({ exec: fake.exec }), { dataDir, repos });
  return {
    repos,
    dataDir,
    state,
    gh,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

describe("F03/M5 gh · snapshots para re-rodar sem rede (F03-9, §6.3 E2E-11)", () => {
  let s: ReturnType<typeof setup>;
  afterEach(() => s?.cleanup());

  it("gh sem conexão vira GhError unavailable", async () => {
    s = setup();
    s.state.offline = true;
    const raw = createGhClient({ exec: fakeGh({ state: { offline: true } }).exec });
    await expect(raw.json(`repos/${REPO}`)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("grava um snapshot por repositório com tamanho e sha256", async () => {
    s = setup();
    await s.gh.json(`repos/${REPO}`);
    await s.gh.raw(`repos/${REPO}/readme`);
    const snaps = s.repos.snapshots.list();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ source: "github", ref: REPO });
    expect(snaps[0]?.size).toBeGreaterThan(0);
    expect(snaps[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("offline: responde do snapshot e marca uso; sem snapshot, falha", async () => {
    s = setup();
    const online = await s.gh.json<{ full_name: string }>(`repos/${REPO}`);
    const readme = await s.gh.raw(`repos/${REPO}/readme`);
    s.state.offline = true;
    expect(await s.gh.json<{ full_name: string }>(`repos/${REPO}`)).toEqual(online);
    expect(await s.gh.raw(`repos/${REPO}/readme`)).toBe(readme);
    expect(s.repos.snapshots.list()[0]?.lastUsedAt).not.toBeNull();
    await expect(s.gh.json("repos/ana-exemplo/painel-web")).rejects.toBeInstanceOf(GhError);
  });

  it("erros que não são de rede (404, 401) não usam o snapshot", async () => {
    s = setup();
    await expect(s.gh.json(`repos/${REPO}/nao-existe`)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await s.gh.tryJson(`repos/${REPO}/nao-existe`)).toBeNull();
  });

  it("resolveGhRuntime com snapshots grava o que o gh falso devolve", async () => {
    s = setup();
    const rt = resolveGhRuntime({
      settings: s.repos.settings,
      configDir: s.dataDir,
      fake: { stateFile: null },
      snapshots: { dataDir: s.dataDir, repos: s.repos },
    });
    await rt.client.json(`repos/${REPO}`);
    expect(s.repos.snapshots.list().map((x) => x.ref)).toContain(REPO);
  });
});
