import { enterUrl } from "./client";
import { loadPairing } from "./storage";

/**
 * Menu do ícone (F12-15, pedido do dono 2026-10-23): a pessoa escolhe o que fazer na página. Numa página com a vaga e o
 * formulário juntos, "Analisar a vaga" lê só a vaga (o fit), e "Ajudar no formulário" lê os campos.
 */
const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function main() {
  const p = await loadPairing();
  if (!p.token || !p.instance) {
    $("unpaired").hidden = false;
    $("connect").addEventListener("click", () => {
      void chrome.runtime.openOptionsPage();
      window.close();
    });
    return;
  }
  $("paired").hidden = false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const mode of ["posting", "form"] as const)
    $(mode).addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "narnia.capture", mode, tabId: tab?.id });
      window.close();
    });
  $("open").addEventListener("click", async () => {
    await chrome.tabs.create({ url: enterUrl(p.instance as string, p.token as string, "/") });
    window.close();
  });
}

void main();
