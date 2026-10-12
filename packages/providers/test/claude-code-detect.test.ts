import { describe, expect, it } from "vitest";
import { ClaudeCodeProvider, type Exec, type ExecResult } from "../src/index";

const AUTH_OUT = (loggedIn: boolean, authMethod: string) =>
  JSON.stringify({
    loggedIn,
    authMethod,
    apiProvider: "firstParty",
    configDirectory: "/home/node/.claude",
  });

function fakeExec(responses: Record<string, ExecResult | Error>): Exec & { calls: string[] } {
  const calls: string[] = [];
  const exec = (async (cmd: string, args: string[]) => {
    const key = [cmd, ...args].join(" ");
    calls.push(key);
    const r = responses[key] ?? responses[args.join(" ")];
    if (!r) throw Object.assign(new Error(`ENOENT: ${key}`), { code: "ENOENT" });
    if (r instanceof Error) throw r;
    return r;
  }) as Exec & { calls: string[] };
  exec.calls = calls;
  return exec;
}

describe("M4/providers ClaudeCodeProvider.detect (claude auth status, zero tokens)", () => {
  it("CLI ausente → installed false, loggedIn false, dica de login", async () => {
    const exec = fakeExec({});
    const p = new ClaudeCodeProvider({ exec, binaryPath: "/nope/claude" });
    const s = await p.detect();
    expect(s).toMatchObject({ installed: false, loggedIn: false, authMethod: "none" });
    expect(s.loginHint).toContain("narnia-jobs login");
  });

  it("auth status com exit 1 e JSON loggedIn=false → não logado, versão lida do --version", async () => {
    const exec = fakeExec({
      "--version": { stdout: "2.1.292 (Claude Code)\n", stderr: "", code: 0 },
      "auth status": { stdout: AUTH_OUT(false, "none"), stderr: "", code: 1 },
    });
    const s = await new ClaudeCodeProvider({ exec, binaryPath: "/bin/claude" }).detect();
    expect(s).toMatchObject({
      installed: true,
      loggedIn: false,
      authMethod: "none",
      version: "2.1.292",
    });
    expect(s.loginHint).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(exec.calls[0]).toBe("/bin/claude --version");
  });

  it("exit 0 com authMethod claude.ai → logado por volume; oauth_token → logado por token do .env", async () => {
    for (const method of ["claude.ai", "oauth_token"] as const) {
      const exec = fakeExec({
        "--version": { stdout: "2.1.292 (Claude Code)", stderr: "", code: 0 },
        "auth status": { stdout: AUTH_OUT(true, method), stderr: "", code: 0 },
      });
      const s = await new ClaudeCodeProvider({ exec, binaryPath: "/bin/claude" }).detect();
      expect(s.loggedIn).toBe(true);
      expect(s.authMethod).toBe(method);
      expect(s.loginHint).toBeNull();
    }
  });

  it("saída de auth status ilegível → tratado como não logado, sem lançar", async () => {
    const exec = fakeExec({
      "--version": { stdout: "2.1.292 (Claude Code)", stderr: "", code: 0 },
      "auth status": { stdout: "not json", stderr: "", code: 1 },
    });
    const s = await new ClaudeCodeProvider({ exec, binaryPath: "/bin/claude" }).detect();
    expect(s.installed).toBe(true);
    expect(s.loggedIn).toBe(false);
  });

  describe("login expirado no volume (2026-10-12: chat falhou com 'OAuth session expired and could not be refreshed')", () => {
    const loggedExec = (method = "claude.ai") =>
      fakeExec({
        "--version": { stdout: "2.1.292 (Claude Code)", stderr: "", code: 0 },
        "auth status": { stdout: AUTH_OUT(true, method), stderr: "", code: 0 },
      });
    const creds = (o: Record<string, unknown>) => JSON.stringify({ claudeAiOauth: o });

    it("credencial esvaziada (expiresAt 0, sem refreshToken) → não logado, authExpired e dica de refazer o login", async () => {
      const s = await new ClaudeCodeProvider({
        exec: loggedExec(),
        binaryPath: "/bin/claude",
        readCredentials: () => creds({ accessToken: "x", expiresAt: 0, scopes: [] }),
      }).detect();
      expect(s).toMatchObject({ loggedIn: false, authMethod: "none", authExpired: true });
      expect(s.loginHint).toMatch(/expirou/);
      expect(s.loginHint).toContain("./start.sh login");
      expect(s.loginHint).toContain("claude setup-token");
    });

    it("acesso vencido mas com refreshToken → segue logado (o CLI renova sozinho)", async () => {
      const s = await new ClaudeCodeProvider({
        exec: loggedExec(),
        binaryPath: "/bin/claude",
        readCredentials: () => creds({ accessToken: "x", refreshToken: "r", expiresAt: 1 }),
      }).detect();
      expect(s.loggedIn).toBe(true);
      expect(s.authExpired).toBeFalsy();
    });

    it("acesso ainda válido sem refreshToken → logado", async () => {
      const s = await new ClaudeCodeProvider({
        exec: loggedExec(),
        binaryPath: "/bin/claude",
        readCredentials: () => creds({ accessToken: "x", expiresAt: Date.now() + 3_600_000 }),
      }).detect();
      expect(s.loggedIn).toBe(true);
    });

    it("token do .env (oauth_token) ignora o arquivo; arquivo ausente ou ilegível mantém o auth status", async () => {
      const viaEnv = await new ClaudeCodeProvider({
        exec: loggedExec("oauth_token"),
        binaryPath: "/bin/claude",
        readCredentials: () => creds({ expiresAt: 0 }),
      }).detect();
      expect(viaEnv.loggedIn).toBe(true);
      for (const raw of [null, "não é json"]) {
        const s = await new ClaudeCodeProvider({
          exec: loggedExec(),
          binaryPath: "/bin/claude",
          readCredentials: () => raw,
        }).detect();
        expect(s.loggedIn).toBe(true);
      }
    });
  });
});
