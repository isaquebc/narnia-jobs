import { useCallback, useEffect, useState } from "react";

/**
 * Abas da janela da extensão (F12-16, pedido do dono 2026-10-23): cada página aberta pela extensão nesta janela fica
 * numa aba, para acompanhar várias (o CV de uma vaga gerando enquanto se olha outra). Ficam no `sessionStorage` da
 * janela, que a extensão reaproveita; a aba guarda de qual aba do Chrome a página veio (voltar e preencher).
 */
export interface WindowTab {
  captureId: string;
  tabId: number | null;
  label: string | null;
  /** Andamento (pedido do dono, 2026-10-27): processando agora, e terminou sem a pessoa ver. */
  busy?: boolean;
  unseen?: boolean;
}

export type TabState = "busy" | "unseen" | "seen";

export const tabState = (t: WindowTab): TabState =>
  t.busy ? "busy" : t.unseen ? "unseen" : "seen";

/** O botão do menu: novidade não vista vence; senão, alguma processando; senão, nada. */
export function menuState(tabs: WindowTab[]): Exclude<TabState, "seen"> | null {
  if (tabs.some((t) => tabState(t) === "unseen")) return "unseen";
  if (tabs.some((t) => t.busy)) return "busy";
  return null;
}

/**
 * Aplica o andamento lido no api: a aba que estava processando e parou fica "não vista", a menos que seja a aberta;
 * a aberta é sempre vista.
 */
export function applyActivity(
  tabs: WindowTab[],
  items: Array<{ id: string; busy: boolean }>,
  selected: string | undefined,
): WindowTab[] {
  const busy = new Map(items.map((i) => [i.id, i.busy]));
  let changed = false;
  const next = tabs.map((t) => {
    const now = busy.get(t.captureId) ?? t.busy ?? false;
    const unseen = t.captureId === selected ? false : (t.unseen ?? false) || (!!t.busy && !now);
    if (now === (t.busy ?? false) && unseen === (t.unseen ?? false)) return t;
    changed = true;
    return { ...t, busy: now, unseen };
  });
  return changed ? next : tabs;
}

const KEY = "narnia.window.tabs";

function load(): WindowTab[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as WindowTab[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(tabs: WindowTab[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // sem sessionStorage (janela privada bloqueada): as abas valem só enquanto a página está aberta
  }
}

export function useWindowTabs(current: {
  captureId?: string | undefined;
  tabId?: number | undefined;
}) {
  const [tabs, setTabs] = useState<WindowTab[]>(load);
  const update = useCallback((fn: (t: WindowTab[]) => WindowTab[]) => {
    setTabs((prev) => {
      const next = fn(prev);
      if (next !== prev) save(next);
      return next;
    });
  }, []);
  useEffect(() => {
    const id = current.captureId;
    if (!id) return;
    update((prev) => {
      const known = prev.find((t) => t.captureId === id);
      if (!known) return [...prev, { captureId: id, tabId: current.tabId ?? null, label: null }];
      if (current.tabId === undefined || known.tabId === current.tabId) return prev;
      return prev.map((t) => (t.captureId === id ? { ...t, tabId: current.tabId ?? null } : t));
    });
  }, [current.captureId, current.tabId, update]);
  const setLabel = useCallback(
    (captureId: string, label: string) =>
      update((prev) =>
        prev.some((t) => t.captureId === captureId && t.label !== label)
          ? prev.map((t) => (t.captureId === captureId ? { ...t, label } : t))
          : prev,
      ),
    [update],
  );
  const close = useCallback(
    (captureId: string) => update((prev) => prev.filter((t) => t.captureId !== captureId)),
    [update],
  );
  const setActivity = useCallback(
    (items: Array<{ id: string; busy: boolean }>, selected: string | undefined) =>
      update((prev) => applyActivity(prev, items, selected)),
    [update],
  );
  return { tabs, setLabel, close, setActivity };
}
