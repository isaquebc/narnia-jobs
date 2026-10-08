import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ResolveBinaryOptions {
  explicit?: string | undefined;
  exists?: (path: string) => boolean;
  /** Procura `claude` no PATH; devolve o caminho ou null. */
  which?: () => string | null;
  /** Pasta do pacote `@anthropic-ai/claude-agent-sdk` (o binário embutido é um pacote irmão). */
  sdkDir?: string | null;
  platform?: string;
  arch?: string;
  musl?: boolean;
}

function defaultWhich(): string | null {
  try {
    const out = execFileSync("sh", ["-c", "command -v claude"], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function defaultSdkDir(): string | null {
  try {
    const url = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
    return dirname(new URL(url).pathname);
  } catch {
    return null;
  }
}

/**
 * Caminho do CLI `claude` (F01 §2.4): explícito → `claude` no PATH → binário embutido no SDK
 * (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`, instalado como dependência opcional). `null` se nada existir.
 */
export function resolveClaudeBinary(opts: ResolveBinaryOptions = {}): string | null {
  const exists = opts.exists ?? existsSync;
  if (opts.explicit) return opts.explicit;
  const fromPath = (opts.which ?? defaultWhich)();
  if (fromPath) return fromPath;
  const sdkDir = opts.sdkDir === undefined ? defaultSdkDir() : opts.sdkDir;
  if (!sdkDir) return null;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const suffix = opts.musl ? "-musl" : "";
  const candidate = join(
    sdkDir,
    "..",
    `claude-agent-sdk-${platform}-${arch}${suffix}`,
    platform === "win32" ? "claude.exe" : "claude",
  );
  return exists(candidate) ? candidate : null;
}
