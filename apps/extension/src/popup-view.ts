import type { Pairing } from "./storage";

/** Ações do menu do ícone (F12-15); no Gmail web, as da F14 (F14-13): confiar, bloquear e processar o e-mail aberto. */
export type PopupAction =
  | "posting"
  | "form"
  | "open"
  | "trust-sender"
  | "block-sender"
  | "process-mail";

export const isGmailUrl = (url: string | undefined) =>
  !!url && /^https:\/\/mail\.google\.com\//.test(url);

export interface PopupView {
  mode: "paired" | "unpaired";
  actions: PopupAction[];
}

/** O que o menu mostra para a aba atual (sem DOM, para testar). */
export function popupView(pairing: Partial<Pairing>, tabUrl: string | undefined): PopupView {
  if (!pairing.token || !pairing.instance) return { mode: "unpaired", actions: [] };
  if (isGmailUrl(tabUrl))
    return { mode: "paired", actions: ["trust-sender", "block-sender", "process-mail", "open"] };
  return { mode: "paired", actions: ["posting", "form", "open"] };
}
