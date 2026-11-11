import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Segredos da instância (F14/M1, §2.5): `<dados>/secrets/<nome>.json`, pasta 0700 e arquivo 0600. Ficam fora do
 * backup de propósito (o backup é por lista de inclusão, RT-I2): depois de restaurar, a pessoa conecta de novo.
 */
export const SECRETS_DIR = "secrets";

const fileOf = (dataDir: string, name: string) => {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`nome de segredo inválido: ${name}`);
  return join(dataDir, SECRETS_DIR, `${name}.json`);
};

export function readSecret<T>(dataDir: string, name: string): T | null {
  const f = fileOf(dataDir, name);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeSecret(dataDir: string, name: string, value: unknown): void {
  const dir = join(dataDir, SECRETS_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const f = fileOf(dataDir, name);
  writeFileSync(f, JSON.stringify(value), { mode: 0o600 });
  chmodSync(f, 0o600);
}

export function deleteSecret(dataDir: string, name: string): void {
  rmSync(fileOf(dataDir, name), { force: true });
}
