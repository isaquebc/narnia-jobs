import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@narnia-jobs/providers";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor";

describe("M4/api narnia-jobs doctor", () => {
  it("reporta auth (volume/token/none), Redis, pasta de dados e worker vivo; exit 0 só quando tudo ok", async () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-doctor-"));
    let readOnly: string | null = null;
    try {
      const ok = await runDoctor({
        provider: new MockProvider({ authMethod: "oauth_token" }),
        dataDir: dir,
        redisPing: async () => "PONG",
        workerHeartbeat: async () => new Date().toISOString(),
      });
      expect(ok.checks).toMatchObject({
        auth: "token",
        redis: true,
        dataDirWritable: true,
        workerAlive: true,
      });
      expect(ok.ok).toBe(true);

      readOnly = mkdtempSync(join(tmpdir(), "narnia-ro-"));
      chmodSync(readOnly, 0o500); // usuário `node` não é root: criar subpasta falha
      const bad = await runDoctor({
        provider: new MockProvider({ loggedIn: false }),
        dataDir: join(readOnly, "sub"),
        redisPing: async () => {
          throw new Error("ECONNREFUSED");
        },
        workerHeartbeat: async () => null,
      });
      expect(bad.checks).toMatchObject({
        auth: "none",
        redis: false,
        dataDirWritable: false,
        workerAlive: false,
      });
      expect(bad.ok).toBe(false);
      expect(bad.hints.join(" ")).toMatch(/narnia-jobs login/);

      const vol = await runDoctor({
        provider: new MockProvider({ authMethod: "claude.ai" }),
        dataDir: dir,
        redisPing: async () => "PONG",
        workerHeartbeat: async () => null,
      });
      expect(vol.checks.auth).toBe("volume");
      expect(vol.checks.workerAlive).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (readOnly) {
        chmodSync(readOnly, 0o700);
        rmSync(readOnly, { recursive: true, force: true });
      }
    }
  });

  it("login do volume esvaziado (refresh falhou) → auth 'expired' e dica de refazer o login ou usar setup-token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-doctor-"));
    try {
      const r = await runDoctor({
        provider: new MockProvider({ loggedIn: false, authExpired: true }),
        dataDir: dir,
        redisPing: async () => "PONG",
        workerHeartbeat: async () => new Date().toISOString(),
      });
      expect(r.checks.auth).toBe("expired");
      expect(r.ok).toBe(false);
      const hints = r.hints.join(" ");
      expect(hints).toMatch(/expirou/);
      expect(hints).toContain("./start.sh login");
      expect(hints).toContain("claude setup-token");
      expect(hints).not.toMatch(/^Não logado/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
