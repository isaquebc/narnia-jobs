/**
 * Service worker (F12/M1): por enquanto o ícone abre as opções (pareamento e teste da conexão). Ler a página e abrir
 * a janela do narnia entram no M2.
 */
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
