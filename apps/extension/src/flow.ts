import type { PageSnapshot } from "./capture/page";
import { enterUrl, type Fetch, sendCapture } from "./client";
import type { Pairing } from "./storage";

/**
 * Clique no ícone (F12/M2), sem depender do Chrome para os testes: sem pareamento abre as opções; pareada, lê a aba,
 * manda a captura e abre a janela do narnia (F12-2). Aba que não dá para ler (páginas do Chrome, loja de extensões)
 * ou envio recusado abrem a janela com o aviso; narnia fora do ar ou dispositivo revogado marcam o ícone e abrem as
 * opções, que mostram o estado da conexão.
 */
export interface FlowDeps {
  loadPairing(): Promise<Partial<Pairing>>;
  readTab(tabId: number): Promise<PageSnapshot>;
  fetch: Fetch;
  openWindow(url: string): Promise<void>;
  openOptions(): Promise<void>;
  setBadge(text: string, title: string): Promise<void>;
}

export const DEFAULT_TITLE = "narnia-jobs";

export async function onIconClick(
  tab: { id?: number | undefined },
  deps: FlowDeps,
): Promise<"options" | "window"> {
  const p = await deps.loadPairing();
  if (!p.token || !p.instance || tab.id === undefined) {
    await deps.openOptions();
    return "options";
  }
  const open = async (next: string) => {
    await deps.openWindow(enterUrl(p.instance as string, p.token as string, next));
    return "window" as const;
  };
  let page: PageSnapshot;
  try {
    page = await deps.readTab(tab.id);
  } catch {
    return open("/candidatura?erro=leitura");
  }
  const r = await sendCapture(deps.fetch, p.instance, p.token, page);
  if (r.ok) {
    await deps.setBadge("", DEFAULT_TITLE);
    return open(`/candidatura?captura=${encodeURIComponent(r.id)}`);
  }
  if (r.reason === "unexpected") return open("/candidatura?erro=envio");
  await deps.setBadge("!", r.message);
  await deps.openOptions();
  return "options";
}
