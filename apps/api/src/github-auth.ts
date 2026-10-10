import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FAKE_GH_STATE_FILENAME,
  type FakeGhState,
  type GhClient,
  GhError,
  INGEST_SETTING_KEYS,
  type Repos,
  readHostToken,
  resolveGhRuntime,
  resolveIngestSettings,
} from "@narnia-jobs/core";
import type { GithubAuthStatusResponse, GithubDeviceResponse } from "@narnia-jobs/shared";

/**
 * Credencial do GitHub na api (F03-1, F03 §2.2). O token nunca sai daqui: o status só diz origem, se está
 * conectado, o login e os escopos. Com o provider mock, um `gh` falso com estado em `.gh-fake.json` e um fluxo
 * de dispositivo falso que o e2e conclui por `POST /api/_test/github`.
 */
export const APP_SCOPES = ["repo", "read:org"];
const APP_SCOPES_KEY = "github.app_scopes";
export const DEVICE_URL = "https://github.com/login/device";
const DEVICE_TTL_MS = 15 * 60_000;

export interface DeviceFlowResult {
  ok: boolean;
  error?: string;
}

export interface DeviceFlowRunner {
  /** Inicia o fluxo e devolve código e URL; `onDone` é chamado quando o usuário autoriza (ou o fluxo falha). */
  start(onDone: (r: DeviceFlowResult) => void): Promise<GithubDeviceResponse>;
  /** Encerra o login próprio do app (`gh auth logout`). */
  logout(): Promise<void>;
}

/** Lê código e URL da saída do `gh auth login --web` (verificado sem TTY: imprime os dois e espera). */
export function parseDeviceOutput(text: string): { code: string; url: string } | null {
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(text)?.[1];
  const url = /(https:\/\/github\.com\/login\/device)/.exec(text)?.[1];
  return code && url ? { code: code.toUpperCase(), url } : null;
}

/** Fluxo real: `gh auth login --web` em segundo plano, com o login gravado no volume `gh-auth` (`GH_CONFIG_DIR`). */
export function createGhDeviceFlow(o: {
  configDir: string;
  spawnFn?: typeof spawn;
}): DeviceFlowRunner {
  const spawnFn = o.spawnFn ?? spawn;
  let current: ChildProcess | null = null;
  const env = () => ({
    ...process.env,
    GH_CONFIG_DIR: o.configDir,
    BROWSER: "true",
    NO_COLOR: "1",
  });
  return {
    start(onDone) {
      current?.kill();
      return new Promise<GithubDeviceResponse>((resolve, reject) => {
        const child = spawnFn(
          "gh",
          [
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--web",
            "--scopes",
            APP_SCOPES.join(","),
          ],
          { env: env(), stdio: ["pipe", "pipe", "pipe"] },
        );
        current = child;
        let out = "";
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill();
            reject(new GhError("failed", "O GitHub CLI não devolveu o código de dispositivo"));
          }
        }, 20_000);
        const onData = (b: Buffer) => {
          out += b.toString("utf8");
          const parsed = parseDeviceOutput(out);
          if (parsed && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve({
              code: parsed.code,
              verificationUri: parsed.url,
              expiresAt: new Date(Date.now() + DEVICE_TTL_MS).toISOString(),
            });
          }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.stdin?.write("\n"); // "Press Enter to open github.com in your browser"
        child.on("error", (e) => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            reject(new GhError("unavailable", `GitHub CLI indisponível: ${e.message}`));
          }
        });
        child.on("close", (code) => {
          // FX item 10: um fluxo substituído por "gerar outro código" morre calado; só o atual avisa o resultado
          if (current !== child) return;
          current = null;
          if (settled)
            onDone(code === 0 ? { ok: true } : { ok: false, error: "Autorização não concluída" });
        });
      });
    },
    async logout() {
      await new Promise<void>((resolve) => {
        const child = spawnFn("gh", ["auth", "logout", "--hostname", "github.com"], {
          env: env(),
          stdio: "ignore",
        });
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
    },
  };
}

/* ---------- gh falso (provider mock) ---------- */

export function fakeStateFile(dataDir: string): string {
  return join(dataDir, FAKE_GH_STATE_FILENAME);
}

export function readFakeState(dataDir: string): FakeGhState & { hostTokenAvailable?: boolean } {
  const f = fakeStateFile(dataDir);
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

export function writeFakeState(
  dataDir: string,
  patch: FakeGhState & { hostTokenAvailable?: boolean },
) {
  writeFileSync(fakeStateFile(dataDir), JSON.stringify({ ...readFakeState(dataDir), ...patch }), {
    mode: 0o600,
  });
}

export interface FakeDeviceFlow extends DeviceFlowRunner {
  /** Simula a autorização no GitHub (e2e). */
  complete(ok?: boolean): void;
}

export function createFakeDeviceFlow(dataDir: string): FakeDeviceFlow {
  let pending: ((r: DeviceFlowResult) => void) | null = null;
  return {
    async start(onDone) {
      pending = onDone;
      return {
        code: "ABCD-1234",
        verificationUri: DEVICE_URL,
        expiresAt: new Date(Date.now() + DEVICE_TTL_MS).toISOString(),
      };
    },
    async logout() {
      writeFakeState(dataDir, { authenticated: false });
    },
    complete(ok = true) {
      if (ok) writeFakeState(dataDir, { authenticated: true });
      const cb = pending;
      pending = null;
      cb?.(ok ? { ok: true } : { ok: false, error: "Autorização negada" });
    },
  };
}

/* ---------- runtime e status ---------- */

export interface GithubAuthDeps {
  repos: Repos;
  dataDir: string;
  configDir: string;
  fake: boolean;
}

export function ghClient(d: GithubAuthDeps): GhClient {
  return resolveGhRuntime({
    settings: d.repos.settings,
    configDir: d.configDir,
    fake: d.fake ? { stateFile: fakeStateFile(d.dataDir) } : null,
    snapshots: { dataDir: d.dataDir, repos: d.repos },
  }).client;
}

export async function githubAuthStatus(d: GithubAuthDeps): Promise<GithubAuthStatusResponse> {
  const source = resolveIngestSettings(d.repos.settings).githubAuth;
  const hostAvailable = d.fake
    ? (readFakeState(d.dataDir).hostTokenAvailable ?? true)
    : readHostToken(d.configDir) !== null;
  let login: string | null = null;
  try {
    login = (await ghClient(d).tryJson<{ login: string }>("user"))?.login ?? null;
  } catch {
    login = null;
  }
  const scopes = source === "app" ? (d.repos.settings.get<string[]>(APP_SCOPES_KEY) ?? []) : [];
  return { source, connected: login !== null, login, scopes, hostAvailable };
}

/** Conclusão do fluxo de dispositivo: o app passa a usar o login próprio. */
export function markAppConnected(repos: Repos): void {
  repos.settings.set(INGEST_SETTING_KEYS.githubAuth, "app");
  repos.settings.set(APP_SCOPES_KEY, APP_SCOPES);
}
