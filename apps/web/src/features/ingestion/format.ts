/** Tokens em formato curto com uma casa decimal quando ajuda (15.1k, 3.3k, 1.5M). */
export function shortTokens(n: number): string {
  const one = (v: number) => v.toFixed(1).replace(/\.0$/, "");
  if (n >= 1_000_000) return `${one(n / 1_000_000)}M`;
  if (n >= 1_000) return `${one(n / 1_000)}k`;
  return String(n);
}
