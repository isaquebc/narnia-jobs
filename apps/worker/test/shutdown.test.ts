import { describe, expect, it } from "vitest";
import { drainThenClose, WORKER_DRAIN_MS_DEFAULT } from "../src/shutdown";

/** Plano de comunicação C7: no SIGTERM o worker para de pegar jobs e espera o ativo até um limite. */
describe("C7 · desligamento gracioso do worker", () => {
  it("espera o job ativo terminar quando ele cabe no limite", async () => {
    const logs: string[] = [];
    let closed = false;
    const r = await drainThenClose({
      close: async () => {
        await new Promise((res) => setTimeout(res, 30));
        closed = true;
      },
      timeoutMs: 1000,
      log: (l) => logs.push(l),
    });
    expect(r).toBe("drained");
    expect(closed).toBe(true);
  });

  it("desiste no limite quando o job não termina e registra o motivo", async () => {
    const logs: string[] = [];
    const r = await drainThenClose({
      close: () => new Promise(() => {}),
      timeoutMs: 40,
      log: (l) => logs.push(l),
    });
    expect(r).toBe("timeout");
    expect(logs.join("\n")).toMatch(/não terminou em 40 ms/);
  });

  it("limite padrão de 60 s, configurável por NARNIA_WORKER_DRAIN_MS", () => {
    expect(WORKER_DRAIN_MS_DEFAULT).toBe(60_000);
  });
});
