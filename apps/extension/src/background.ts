import { type BridgeDeps, type BridgeRequest, handleBridge } from "./bridge";
import type { FillItem } from "./capture/fill";
import { type FrameForm, mergeFrames } from "./capture/frames";
import type { PageSnapshot } from "./capture/page";
import { type CaptureMode, DEFAULT_TITLE, onIconClick, type TabCapture } from "./flow";
import { loadPairing } from "./storage";

/**
 * Service worker (F12/M2): o clique no ícone lê a aba (só ela e só agora, pelo `activeTab`) e abre a janela do narnia
 * ao lado (F12-2), reaproveitando a que já estiver aberta.
 */
const WINDOW = { width: 480, height: 860 };

async function readTab(tabId: number): Promise<TabCapture> {
  // todos os quadros que a extensão pode ler: o de cima pelo `activeTab`, os de outro site só com permissão (F12/M3)
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["capture.js"],
  });
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (globalThis as { __narniaSnapshot?: () => unknown }).__narniaSnapshot?.(),
  });
  if (!r?.result) throw new Error("leitura vazia");
  const forms = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (globalThis as { __narniaForm?: () => unknown }).__narniaForm?.(),
  });
  const frames = forms.map((f) => f.result).filter((x): x is FrameForm => !!x);
  return { ...(r.result as PageSnapshot), form: mergeFrames(frames) };
}

/** Página da extensão que pede a permissão do quadro (a permissão só sai com o clique da pessoa). */
async function openPermission(tabId: number, origins: string[]) {
  const q = new URLSearchParams({ tab: String(tabId), origins: origins.join(",") });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`permission.html?${q}`),
    type: "popup",
    width: 420,
    height: 360,
  });
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

const click = (tab: { id?: number }, mode: CaptureMode = "auto") =>
  onIconClick(
    tab,
    {
      loadPairing,
      readTab,
      fetch: (url, init) => fetch(url, init),
      openWindow,
      openOptions: () => chrome.runtime.openOptionsPage(),
      setBadge,
      openPermission,
    },
    mode,
  );

/** Preenche na aba (F12-14): cada quadro recebe as suas referências, na mesma ordem em que foram lidas e juntadas. */
async function fillTab(tabId: number, items: FillItem[]) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["capture.js"],
  });
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => (globalThis as { __narniaForm?: () => unknown }).__narniaForm?.(),
  });
  const filled: string[] = [];
  const failed = new Set(items.map((i) => i.ref));
  let offset = 0;
  for (const f of frames) {
    const count = (f.result as FrameForm | undefined)?.fields.length ?? 0;
    const local = items
      .map((i) => ({ ...i, n: Number(i.ref.slice(1)) - offset }))
      .filter((i) => i.n >= 1 && i.n <= count)
      .map((i) => ({ ref: `f${i.n}`, value: i.value, global: i.ref }));
    if (local.length && f.frameId !== undefined) {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [f.frameId] },
        func: (list: FillItem[]) =>
          (globalThis as { __narniaFill?: (l: FillItem[]) => unknown }).__narniaFill?.(list),
        args: [local.map(({ ref, value }) => ({ ref, value }))],
      });
      const done = new Set((r?.result as { filled?: string[] } | undefined)?.filled ?? []);
      for (const l of local)
        if (done.has(l.ref)) {
          filled.push(l.global);
          failed.delete(l.global);
        }
    }
    offset += count;
  }
  return { filled, failed: [...failed] };
}

const bridgeDeps: BridgeDeps = {
  loadPairing,
  tabUrl: async (tabId) => (await chrome.tabs.get(tabId).catch(() => null))?.url ?? null,
  focusTab: async (tabId) => {
    const t = await chrome.tabs.update(tabId, { active: true });
    if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
  },
  openUrl: async (url) => {
    await chrome.windows.create({ url, type: "normal" });
  },
  fillTab,
};

chrome.action.onClicked.addListener((tab) => void click(tab));
chrome.runtime.onMessage.addListener(
  (
    msg: { type?: string; tabId?: number; mode?: CaptureMode; request?: BridgeRequest },
    sender: { url?: string; tab?: { url?: string } },
    sendResponse: (r: unknown) => void,
  ) => {
    // permissão do quadro concedida na página da extensão: lê a aba de novo, agora com o quadro
    if (msg?.type === "narnia.recapture" && typeof msg.tabId === "number")
      void click({ id: msg.tabId });
    // menu do ícone (F12-15)
    if (msg?.type === "narnia.capture" && typeof msg.tabId === "number")
      void click({ id: msg.tabId }, msg.mode ?? "auto");
    // pedido da janela do narnia, pela ponte da página (F12-14, F12-17)
    if (msg?.type === "narnia.bridge" && msg.request) {
      void handleBridge(msg.request, sender.tab?.url ?? sender.url, bridgeDeps).then(sendResponse);
      return true;
    }
    return false;
  },
);
// e2e (F12/E2E-02): o Playwright não clica na barra do Chrome; chama o mesmo fluxo pelo service worker
(globalThis as { narniaIconClick?: typeof click }).narniaIconClick = click;
