/**
 * HTML com escape automático para os templates padrão do CV (F05 §2.6): todo valor interpolado é escapado, a não ser
 * que venha de `raw()` (CSS e fontes do próprio template) ou de outro `html\`…\``. Listas são concatenadas.
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

export const raw = (s: string) => new SafeHtml(s);

type Part = SafeHtml | string | number | null | undefined | false | Part[];

function render(p: Part): string {
  if (p === null || p === undefined || p === false) return "";
  if (Array.isArray(p)) return p.map(render).join("");
  if (p instanceof SafeHtml) return p.value;
  return escapeHtml(String(p));
}

export function html(strings: TemplateStringsArray, ...values: Part[]): SafeHtml {
  let out = strings[0] as string;
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] as string);
  });
  return new SafeHtml(out);
}
