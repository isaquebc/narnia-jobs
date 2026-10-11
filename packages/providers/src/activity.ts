import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Batimento por job (plano de comunicação C3, 2026-10-11): durante uma chamada longa ao modelo não havia nenhum
 * evento, e a tela não distinguia "trabalhando" de "parado". O worker roda cada job dentro de `runWithActivity` com um
 * observador (que limita a 1 evento a cada 15 s); o provider chama `reportActivity()` a cada mensagem do stream do SDK.
 * Fica no contexto assíncrono do job, então jobs concorrentes não se misturam e as assinaturas não mudam.
 */
const store = new AsyncLocalStorage<() => void>();

export function runWithActivity<T>(onActivity: () => void, fn: () => Promise<T>): Promise<T> {
  return store.run(onActivity, fn);
}

export function reportActivity(): void {
  const cb = store.getStore();
  if (!cb) return;
  try {
    cb();
  } catch {
    // o batimento nunca derruba a chamada
  }
}
