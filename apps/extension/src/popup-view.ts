import type { Pairing } from "./storage";

/** Ações do menu do ícone (F12-15); a F14 acrescenta as do Gmail. */
export type PopupAction = "posting" | "form" | "open";

export interface PopupView {
  mode: "paired" | "unpaired";
  actions: PopupAction[];
}

/** O que o menu mostra para a aba atual (sem DOM, para testar). */
export function popupView(pairing: Partial<Pairing>, _tabUrl: string | undefined): PopupView {
  if (!pairing.token || !pairing.instance) return { mode: "unpaired", actions: [] };
  return { mode: "paired", actions: ["posting", "form", "open"] };
}
