/** Utilitários de mapeamento linha ↔ objeto (snake_case no SQLite, camelCase no domínio). */

export type Row = Record<string, unknown>;

export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Remove chaves de um objeto de parâmetros (o `node:sqlite` rejeita parâmetros nomeados que o SQL não usa). */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}
