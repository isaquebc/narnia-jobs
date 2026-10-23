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
  return { tabs, setLabel, close };
}
