/**
 * Leitura da aba (F12/M2), injetada só no clique (`activeTab`): o HTML renderizado vai para o narnia, que tira a vaga
 * com o extrator da F06. Sai o que não ajuda a ler (scripts, estilos, mídia) e o que não deve sair do navegador
 * (campos ocultos com token, senhas, valores digitados, meta de CSRF); o JSON-LD da vaga fica. Trabalha numa cópia:
 * a página da pessoa não muda.
 */
export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
}

const DROP = [
  'script:not([type="application/ld+json"])',
  "style",
  "link",
  "noscript",
  "template",
  "svg",
  "canvas",
  "img",
  "picture",
  "video",
  "audio",
  "iframe",
  "object",
  "embed",
  'input[type="hidden"]',
  'input[type="password"]',
  'meta[name*="csrf" i]',
  'meta[name*="token" i]',
].join(", ");

export function snapshotPage(doc: Document): PageSnapshot {
  const copy = doc.documentElement.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll(DROP)) el.remove();
  for (const el of copy.querySelectorAll("input")) el.removeAttribute("value");
  for (const el of copy.querySelectorAll("textarea")) el.textContent = "";
  for (const el of copy.querySelectorAll("[style]")) el.removeAttribute("style");
  return { url: doc.location.href, title: doc.title, html: `<!doctype html>${copy.outerHTML}` };
}
