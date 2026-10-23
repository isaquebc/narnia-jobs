import type { PageSnapshot } from "./capture/page";
import { DEFAULT_TITLE, onIconClick } from "./flow";
import { loadPairing } from "./storage";

/**
 * Service worker (F12/M2): o clique no ícone lê a aba (só ela e só agora, pelo `activeTab`) e abre a janela do narnia
 * ao lado (F12-2), reaproveitando a que já estiver aberta.
 */
const WINDOW = { width: 480, height: 860 };

async function readTab(tabId: number): Promise<PageSnapshot> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] });
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (globalThis as { __narniaSnapshot?: () => unknown }).__narniaSnapshot?.(),
  });
  if (!r?.result) throw new Error("leitura vazia");
  return r.result as PageSnapshot;
}

async function openWindow(url: string) {
  const { narniaWindow } = await chrome.storage.session.get(["narniaWindow"]);
  if (typeof narniaWindow === "number") {
    try {
      const w = await chrome.windows.get(narniaWindow, { populate: true });
      const tabId = w.tabs?.[0]?.id;
      if (tabId !== undefined) {
        await chrome.tabs.update(tabId, { url });
        await chrome.windows.update(narniaWindow, { focused: true });
        return;
      }
    } catch {
      // a janela foi fechada: abre outra
    }
  }
  // ao lado direito da janela atual, quando dá para saber onde ela está
  const current = await chrome.windows.getCurrent().catch(() => null);
  const left =
    current?.left !== undefined && current.width !== undefined
      ? Math.max(0, current.left + current.width - WINDOW.width - 16)
      : undefined;
  const top = current?.top !== undefined ? current.top + 64 : undefined;
  // posição fora da tela (outro monitor, janela maximizada) é recusada pelo Chrome: abre onde ele quiser
  const w = await chrome.windows
    .create({
      url,
      type: "popup",
      ...WINDOW,
      ...(left !== undefined ? { left } : {}),
      ...(top !== undefined ? { top } : {}),
    })
    .catch(() => chrome.windows.create({ url, type: "popup", ...WINDOW }));
  await chrome.storage.session.set({ narniaWindow: w.id });
}

async function setBadge(text: string, title: string) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title: title || DEFAULT_TITLE });
}

const click = (tab: { id?: number }) =>
  onIconClick(tab, {
    loadPairing,
    readTab,
    fetch: (url, init) => fetch(url, init),
    openWindow,
    openOptions: () => chrome.runtime.openOptionsPage(),
    setBadge,
  });

chrome.action.onClicked.addListener((tab) => void click(tab));
// e2e (F12/E2E-02): o Playwright não clica na barra do Chrome; chama o mesmo fluxo pelo service worker
(globalThis as { narniaIconClick?: typeof click }).narniaIconClick = click;
