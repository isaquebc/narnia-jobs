import { formatDateOnly, formatInUserTz, isDateOnly } from "@narnia-jobs/shared";

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 || n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Datas: instantes em UTC → fuso do usuário; datas sem hora → sem conversão (03 §17). */
export function formatDate(value: string, timezone: string, format?: string): string {
  if (isDateOnly(value)) return formatDateOnly(value, "pt-BR");
  return formatInUserTz(value, timezone, format);
}

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

export function formatMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-");
  return `${m}/${y}`;
}
