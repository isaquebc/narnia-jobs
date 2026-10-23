import { readForm } from "./form";
import { snapshotPage } from "./page";

/**
 * Injetado na aba pelo service worker (`capture.js`), em todos os quadros que a extensão pode ler: deixa a leitura da
 * página (só o quadro de cima a usa) e a do formulário (F12/M3) à mão para a chamada seguinte.
 */
const g = globalThis as { __narniaSnapshot?: () => unknown; __narniaForm?: () => unknown };
g.__narniaSnapshot = () => snapshotPage(document);
g.__narniaForm = () => ({ origin: location.origin, ...readForm(document) });
