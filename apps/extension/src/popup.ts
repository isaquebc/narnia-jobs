import { enterUrl, sendMailAction } from "./client";
import { readGmailOpenMessage } from "./gmail-page";
import { popupView } from "./popup-view";
import { loadPairing } from "./storage";

/**
 * Menu do ícone (F12-15, pedido do dono 2026-10-23): a pessoa escolhe o que fazer na página. Numa página com a vaga e o
 * formulário juntos, "Analisar a vaga" lê só a vaga (o fit), e "Ajudar no formulário" lê os campos.
 */
const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function main() {
  const p = await loadPairing();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const view = popupView(p, tab?.url);
  if (view.mode === "unpaired") {
    $("unpaired").hidden = false;
    $("connect").addEventListener("click", () => {
      void chrome.runtime.openOptionsPage();
      window.close();
    });
    return;
  }
  $("paired").hidden = false;
  for (const id of ["posting", "form", "open", "trust-sender", "block-sender", "process-mail"])
    $(id).hidden = !view.actions.includes(id as never);
  $("posting-hint").hidden = $("posting").hidden;
  $("form-hint").hidden = $("form").hidden;
  $("mail-hint").hidden = $("trust-sender").hidden;
  // F14/M3 · Gmail web: confiar, bloquear ou processar o e-mail aberto
  const result = $("mail-result");
  const mail = async (kind: "trust" | "block" | "process") => {
    result.hidden = false;
    result.textContent = "…";
    let r: { result?: unknown } | undefined;
    try {
      [r] = tab?.id
        ? await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: readGmailOpenMessage,
          })
        : [];
    } catch {
      result.textContent =
        "Não consegui ler esta aba do Gmail. Recarregue a página e tente de novo.";
      return;
    }
    const open = (r?.result ?? { sender: null, messageId: null }) as ReturnType<
      typeof readGmailOpenMessage
    >;
    if (kind === "process" ? !open.messageId : !open.sender) {
      result.textContent = "Abra um e-mail no Gmail e clique de novo.";
      return;
    }
    const out = await sendMailAction(
      fetch,
      p.instance as string,
      p.token as string,
      kind === "process"
        ? { kind, messageId: open.messageId as string }
        : { kind, sender: open.sender as string },
    );
    result.textContent = out.message;
  };
  $("trust-sender").addEventListener("click", () => void mail("trust"));
  $("block-sender").addEventListener("click", () => void mail("block"));
  $("process-mail").addEventListener("click", () => void mail("process"));
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
