import type { FillItem } from "./capture/fill";
import type { Pairing } from "./storage";

/**
 * Ponte entre a janela do narnia e a extensão (F12-14, F12-17): a página do narnia manda o pedido por `postMessage`, o
 * script de conteúdo (`page-bridge`) repassa ao service worker, e só a página do narnia pareado é atendida. A aba
 * conta como "a mesma página" quando o endereço é o mesmo, sem a âncora (`#…`).
 */
export type BridgeRequest =
  | { type: "narnia.focus"; tabId: number; url: string }
  | { type: "narnia.fill"; tabId: number; url: string; items: FillItem[] }
  | { type: "narnia.readForm"; tabId: number; captureId: string };

export type BridgeResponse =
  | { ok: true; focused: boolean }
  | { ok: true; filled: string[]; failed: string[] }
  | { ok: true; applicationId: string; step?: number; added?: boolean }
  | { ok: true; permission: true }
  | { ok: false; error: string; code?: string };

export interface BridgeDeps {
  loadPairing(): Promise<Partial<Pairing>>;
  /** Endereço atual da aba, ou null se ela foi fechada. */
  tabUrl(tabId: number): Promise<string | null>;
  focusTab(tabId: number): Promise<void>;
  openUrl(url: string): Promise<void>;
  fillTab(tabId: number, items: FillItem[]): Promise<{ filled: string[]; failed: string[] }>;
  /** Procurar o formulário na aba da vaga (pedido do dono, 2026-10-27): `readFormInto`. */
  readForm(tabId: number, captureId: string): Promise<BridgeResponse>;
}

const origin = (u: string | undefined) => {
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
};
const samePage = (a: string | null, b: string) => !!a && a.split("#")[0] === b.split("#")[0];

export async function handleBridge(
  msg: BridgeRequest,
  senderUrl: string | undefined,
  deps: BridgeDeps,
): Promise<BridgeResponse> {
  const p = await deps.loadPairing();
  if (!p.instance || origin(senderUrl) !== origin(p.instance))
    return { ok: false, error: "origem não é o narnia pareado" };
  if (msg.type === "narnia.readForm") return deps.readForm(msg.tabId, msg.captureId);
  const current = await deps.tabUrl(msg.tabId);
  if (msg.type === "narnia.focus") {
    if (samePage(current, msg.url)) {
      await deps.focusTab(msg.tabId);
      return { ok: true, focused: true };
    }
    await deps.openUrl(msg.url);
    return { ok: true, focused: false };
  }
  if (!samePage(current, msg.url))
    return {
      ok: false,
      error:
        "A aba não está mais no formulário. Abra a página do formulário e clique no narnia de novo.",
    };
  const r = await deps.fillTab(msg.tabId, msg.items);
  return { ok: true, ...r };
}
