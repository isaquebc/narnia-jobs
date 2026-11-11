/**
 * F14/M3 · leitura mínima do Gmail web pela extensão (F14-13): só o endereço do remetente e o id da mensagem aberta,
 * nada do assunto nem do corpo. Roda dentro da aba (via `chrome.scripting.executeScript`), então não pode importar
 * nada: tudo dentro da função.
 */
export interface GmailOpenMessage {
  sender: string | null;
  /** Id da mensagem na API do Gmail (hexadecimal, `data-legacy-message-id`). */
  messageId: string | null;
}

export function readGmailOpenMessage(): GmailOpenMessage {
  // a última mensagem expandida da conversa aberta é a que a pessoa está vendo; remetente e id saem do mesmo nó
  // (revisão do M3: nada de pegar o remetente de outra mensagem da página)
  const expanded = Array.from(document.querySelectorAll<HTMLElement>("div.adn"));
  const scope = expanded[expanded.length - 1];
  if (!scope) return { sender: null, messageId: null };
  const sender =
    scope
      .querySelector<HTMLElement>("span.gD[email]")
      ?.getAttribute("email")
      ?.trim()
      .toLowerCase() || null;
  const idEl = scope.hasAttribute("data-legacy-message-id")
    ? scope
    : scope.querySelector<HTMLElement>("[data-legacy-message-id]");
  const messageId = idEl?.getAttribute("data-legacy-message-id")?.trim() || null;
  return { sender, messageId: messageId && /^[0-9a-f]{8,32}$/i.test(messageId) ? messageId : null };
}
