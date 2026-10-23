/**
 * Script de conteúdo na página do narnia (F12-14, F12-17): avisa a página que a extensão está instalada e repassa ao
 * service worker os pedidos da janela (voltar à página analisada, preencher). Só mensagens da própria página; o
 * service worker confere que ela é o narnia pareado.
 */
document.documentElement.dataset.narniaExtension = "1";

window.addEventListener("message", (e: MessageEvent) => {
  const data = e.data as { source?: string; id?: string; request?: unknown } | null;
  if (e.source !== window || data?.source !== "narnia-web" || typeof data.id !== "string") return;
  void chrome.runtime
    .sendMessage({ type: "narnia.bridge", request: data.request })
    .catch((err: unknown) => ({ ok: false, error: String(err) }))
    .then((response) =>
      window.postMessage({ source: "narnia-ext", id: data.id, response }, location.origin),
    );
});
