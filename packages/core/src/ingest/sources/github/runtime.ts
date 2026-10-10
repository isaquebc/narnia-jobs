import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Repos } from "../../../db";
import type { SettingsRepo } from "../../../db/repos/settings";
import { fakeGh } from "../../../testing/fake-gh";
import { resolveIngestSettings } from "../../settings";
import { createCloneTreeLister, createDefaultGitExec, type TreeEntry } from "./collect";
import { createDefaultGhExec, createGhClient, type GhClient } from "./gh";
import { withSnapshots } from "./snapshot";

/**
 * Credencial do `gh` em runtime (F03-1, F03 §2.2): `host` lê o token que o lançador grava no volume `gh-auth`
 * (`host-token`, 0600) e o passa só ao processo filho; `app` usa o login próprio do `gh` no mesmo volume
 * (`hosts.yml`); `host` sem token cai em `app`. Com o provider mock, um `gh` falso sobre respostas gravadas.
 * O token nunca sai daqui: não vai para banco, log, resposta da api nem para o objeto devolvido.
 */
export const GH_HOST_TOKEN_FILE = "host-token";

export type GhCredentialSource = "host" | "app" | "fake";

export function defaultGhConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.GH_CONFIG_DIR || join(homedir(), ".config", "gh");
}

export function readHostToken(configDir: string): string | null {
  const file = join(configDir, GH_HOST_TOKEN_FILE);
  if (!existsSync(file)) return null;
  const token = readFileSync(file, "utf8").trim();
  return token.length > 0 ? token : null;
}

export interface GhRuntime {
  client: GhClient;
  source: GhCredentialSource;
  /** Clone de fallback para árvore truncada (F03-4, correções F03 item 13); `null` com o `gh` falso. */
  cloneTree: ((fullName: string) => Promise<TreeEntry[]>) | null;
}

export function resolveGhRuntime(o: {
  settings: SettingsRepo;
  configDir: string;
  fake?: { stateFile: string | null } | null;
  /** Grava e reaproveita snapshots (F03-9): sem rede, o que já foi lido responde. */
  snapshots?: { dataDir: string; repos: Repos } | null;
}): GhRuntime {
  const wrap = (c: GhClient) => (o.snapshots ? withSnapshots(c, o.snapshots) : c);
  if (o.fake) {
    return {
      client: wrap(createGhClient({ exec: fakeGh({ stateFile: o.fake.stateFile }).exec })),
      source: "fake",
      cloneTree: null,
    };
  }
  const wanted = resolveIngestSettings(o.settings).githubAuth;
  const token = wanted === "host" ? readHostToken(o.configDir) : null;
  const exec = createDefaultGhExec({ token });
  // o token fica só na closure do executor; o objeto devolvido não o carrega
  return {
    client: wrap(createGhClient({ exec, token })),
    source: token ? "host" : "app",
    cloneTree: createCloneTreeLister({ exec, git: createDefaultGitExec() }),
  };
}
