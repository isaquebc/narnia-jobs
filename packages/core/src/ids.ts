import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

interface Seeded {
  seed: string;
  n: number;
}

const seeded = new AsyncLocalStorage<Seeded>();

/** Início fixo do relógio dos ids determinísticos (o tempo do UUID v7 é esse mais o contador: únicos e ordenados). */
const SEEDED_EPOCH_MS = Date.UTC(2026, 0, 1);

/** UUID v7 cujo tempo é o contador e a parte aleatória vem do hash da semente com o contador. */
function seededId(s: Seeded): string {
  const n = s.n++;
  const time = (SEEDED_EPOCH_MS + n).toString(16).padStart(12, "0");
  const h = createHash("sha256").update(`${s.seed}:${n}`).digest("hex");
  const variant = ((Number.parseInt(h[3] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${h.slice(0, 3)}-${variant}${h.slice(4, 7)}-${h.slice(7, 19)}`;
}

/** Identificadores UUID v7, ordenáveis por tempo (decisão F01-19). */
export function newId(): string {
  const s = seeded.getStore();
  return s ? seededId(s) : uuidv7();
}

/**
 * Ids determinísticos dentro de `fn` (R5, 2026-11-04): a fixture do sandbox das avaliações ganha os mesmos ids em toda
 * amostra e nas duas versões do gate, porque o juiz recebe o índice dos fatos de uma amostra só e confere as citações
 * `[f:…]` de todas. Vale através de `await`; fora do escopo, `newId` volta ao UUID v7 aleatório.
 */
export function withSeededIds<T>(seed: string, fn: () => Promise<T>): Promise<T> {
  return seeded.run({ seed, n: 0 }, fn);
}
