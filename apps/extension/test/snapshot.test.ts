// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { snapshotPage } from "../src/capture/page";

/**
 * F12/M2 · leitura da aba: o HTML renderizado vai para o narnia sem scripts, estilos, mídia nem segredos de formulário
 * (campos ocultos com token, senhas, valores digitados); o JSON-LD da vaga fica. A página original não muda.
 */
function page(body: string, head = "") {
  document.head.innerHTML = `<title>Vaga · Portal</title>${head}`;
  document.body.innerHTML = body;
  return document;
}

describe("F12/M2 · snapshot da página", () => {
  it("tira scripts, estilos e mídia; mantém o JSON-LD, o texto e a URL", () => {
    const doc = page(
      `<main><h1>Backend Sr</h1><p>Descrição</p><img src="x.png"><svg><path/></svg>
       <script>window.track()</script><iframe src="https://ads.example"></iframe></main>`,
      `<style>body{}</style><link rel="stylesheet" href="a.css">
       <script type="application/ld+json">{"@type":"JobPosting"}</script><script src="app.js"></script>`,
    );
    const s = snapshotPage(doc);
    expect(s.title).toBe("Vaga · Portal");
    expect(s.url).toBe(document.location.href);
    expect(s.html).toContain("<h1>Backend Sr</h1>");
    expect(s.html).toContain('"@type":"JobPosting"');
    for (const gone of [
      "window.track",
      "app.js",
      "body{}",
      "a.css",
      "x.png",
      "<svg",
      "ads.example",
    ])
      expect(s.html).not.toContain(gone);
    // a página da pessoa continua intacta
    expect(document.querySelector("script:not([type])")).not.toBeNull();
  });

  it("não leva segredos de formulário: campo oculto, senha, valor digitado, token CSRF", () => {
    const doc = page(
      `<form><input type="hidden" name="csrf" value="segredo-1">
       <input type="password" value="segredo-2"><input name="email" value="segredo-3">
       <textarea>segredo-4</textarea><label>Nome</label></form>`,
      `<meta name="csrf-token" content="segredo-5">`,
    );
    const s = snapshotPage(doc);
    for (const n of [1, 2, 3, 4, 5]) expect(s.html).not.toContain(`segredo-${n}`);
    expect(s.html).toContain("<label>Nome</label>");
  });
});
