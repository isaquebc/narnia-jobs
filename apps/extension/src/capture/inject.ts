import { snapshotPage } from "./page";

/** Injetado na aba pelo service worker (`capture.js`): deixa a leitura à mão para a chamada seguinte. */
(globalThis as { __narniaSnapshot?: () => unknown }).__narniaSnapshot = () =>
  snapshotPage(document);
