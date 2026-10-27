/**
 * Permissão de quadro (F12/M3, §4.3): o Chrome só concede `optional_host_permissions` num clique da pessoa numa página
 * da extensão. Concedida, o service worker lê a aba de novo, agora com o quadro do formulário.
 */
const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tab"));
// o botão da janela (pedido do dono, 2026-10-27): a releitura entra na captura da vaga
const captureId = params.get("capture");
const origins = (params.get("origins") ?? "").split(",").filter((o) => /^https:\/\//.test(o));

const list = document.getElementById("origins") as HTMLUListElement;
for (const o of origins) {
  const li = document.createElement("li");
  li.textContent = new URL(o).host;
  list.append(li);
}
const statusLine = document.getElementById("status") as HTMLParagraphElement;

document.getElementById("allow")?.addEventListener("click", async () => {
  const granted = await chrome.permissions.request({ origins: origins.map((o) => `${o}/*`) });
  if (!granted) {
    statusLine.textContent = "Sem a permissão, cole as perguntas no chat do narnia.";
    return;
  }
  await chrome.runtime.sendMessage({
    type: "narnia.recapture",
    tabId,
    ...(captureId ? { captureId } : {}),
  });
  window.close();
});
document.getElementById("cancel")?.addEventListener("click", () => window.close());
