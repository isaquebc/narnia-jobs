import { join } from "node:path";
import { ClaudeCodeProvider } from "./claude-code/claude-code-provider";
import { MockProvider } from "./mock/mock-provider";
import type { Provider } from "./provider";

export type ProviderId = "mock" | "claude-code";

/** `NARNIA_PROVIDER=mock|claude-code` (padrão claude-code). O mock nunca chama o modelo. */
export function providerIdFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProviderId {
  return env.NARNIA_PROVIDER === "mock" ? "mock" : "claude-code";
}

/** Nome do arquivo de modo do mock dentro da pasta de dados (compartilhado por api e worker, F01-73). */
export const MOCK_MODE_FILENAME = ".mock-mode.json";

export function createProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): Provider {
  if (providerIdFromEnv(env) !== "mock") return new ClaudeCodeProvider();
  const dataDir = env.NARNIA_DATA_DIR;
  return new MockProvider({ modeFile: dataDir ? join(dataDir, MOCK_MODE_FILENAME) : null });
}
