import { createHash, randomBytes, randomInt } from "node:crypto";

/**
 * Pareamento da extensão do navegador (F12-4, F12-9): Configurações mostra um código curto de uso único; a extensão o
 * troca por um token de dispositivo persistente (o token de boot muda a cada reinício). O banco guarda só hashes.
 */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I, que se confundem ao digitar
const TOKEN_PREFIX = "nxd_";

export function generatePairingCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generateDeviceToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("hex");
}

export const isDeviceToken = (token: string) => token.startsWith(TOKEN_PREFIX);

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
