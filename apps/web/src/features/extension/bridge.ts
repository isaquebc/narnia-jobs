/**
 * Ponte com a extensão (F12-14, F12-17): o script de conteúdo da extensão marca a página (`data-narnia-extension`) e
 * repassa os pedidos por `postMessage` ao service worker, que só atende o narnia pareado. Sem a extensão (ou com uma
 * versão antiga), a janela segue sem voltar à aba nem preencher.
 */
export type BridgeRequest =
  | { type: "narnia.focus"; tabId: number; url: string }
  | {
      type: "narnia.fill";
      tabId: number;
      url: string;
      items: Array<{ ref: string; value: string }>;
    }
  | { type: "narnia.readForm"; tabId: number; captureId: string };

export type BridgeResponse =
  | {
      ok: true;
      focused?: boolean;
      filled?: string[];
      failed?: string[];
      applicationId?: string;
      permission?: boolean;
    }
  | { ok: false; error: string; code?: string };

export const extensionAvailable = () => document.documentElement.dataset.narniaExtension === "1";

export function bridgeRequest(request: BridgeRequest, timeoutMs = 15_000): Promise<BridgeResponse> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const done = (r: BridgeResponse) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; id?: string; response?: BridgeResponse } | null;
      if (d?.source === "narnia-ext" && d.id === id)
        done(d.response ?? { ok: false, error: "resposta vazia da extensão" });
    };
    const timer = setTimeout(
      () =>
        done({
          ok: false,
          error: "A extensão não respondeu. Recarregue-a em chrome://extensions.",
        }),
      timeoutMs,
    );
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "narnia-web", id, request }, location.origin);
  });
}
