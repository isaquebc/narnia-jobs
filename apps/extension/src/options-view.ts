import type { ConnectionResult } from "./client";
import type { Pairing } from "./storage";

/**
 * O que a página de opções mostra (F12/M1): sem token ou com o dispositivo revogado, o formulário de pareamento;
 * pareada, só o estado da conexão, com a hora da verificação para "Testar conexão" sempre dar retorno visível.
 */
export interface OptionsView {
  mode: "pair" | "connected";
  tone: "ok" | "error" | "";
  text: string;
}

export function optionsView(
  p: Partial<Pairing>,
  c: ConnectionResult | null,
  now: Date,
): OptionsView {
  if (!p.token) return { mode: "pair", tone: "", text: "Ainda não pareado." };
  const checked = `Verificado às ${now.toLocaleTimeString("pt-BR", { hour12: false })}.`;
  if (c?.ok)
    return {
      mode: "connected",
      tone: "ok",
      text: `Conectado como "${c.deviceName ?? p.deviceName}" (narnia ${c.version}). ${checked}`,
    };
  if (c?.reason === "unauthorized") return { mode: "pair", tone: "error", text: c.message };
  return { mode: "connected", tone: c ? "error" : "", text: c ? `${c.message} ${checked}` : "" };
}
