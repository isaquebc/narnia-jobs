import { type FillItem, fillForm } from "./fill";
import { readForm } from "./form";
import { snapshotPage } from "./page";

/**
 * Injetado na aba pelo service worker (`capture.js`), em todos os quadros que a extensão pode ler: deixa à mão a
 * leitura da página (só o quadro de cima a usa), a do formulário (F12/M3) e o preenchimento (F12-14, só no clique).
 */
const g = globalThis as {
  __narniaSnapshot?: () => unknown;
  __narniaForm?: () => unknown;
  __narniaFill?: (items: FillItem[]) => unknown;
};
g.__narniaSnapshot = () => snapshotPage(document);
g.__narniaForm = () => ({ origin: location.origin, ...readForm(document) });
g.__narniaFill = (items) => fillForm(document, items);
