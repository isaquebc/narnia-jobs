import { describe, expect, it } from "vitest";
import { createQueues, QUEUE_NAMES } from "../src/queues";

class FakeQueue {
  readonly name: string;
  readonly opts: unknown;
  constructor(name: string, opts: unknown) {
    this.name = name;
    this.opts = opts;
  }
}

describe("M1/worker createQueues", () => {
  it("cria uma fila por nome, com prefixo e conexão injetada, sem tocar no Redis", () => {
    const connection = { host: "fake", port: 0 };
    const queues = createQueues({ connection, prefix: "narnia", QueueCtor: FakeQueue });
    expect(Object.keys(queues).sort()).toEqual([...QUEUE_NAMES].sort());
    for (const name of QUEUE_NAMES) {
      const q = queues[name] as unknown as FakeQueue;
      expect(q.name).toBe(name);
      expect(q.opts).toMatchObject({ connection, prefix: "narnia" });
    }
  });

  it("filas de F01 são ingest, ocr e extract", () => {
    expect(QUEUE_NAMES).toEqual(["ingest", "ocr", "extract"]);
  });
});

describe("F05/M7 · concorrência em tempo de execução", async () => {
  const { applyConcurrency } = await import("../src/worker");
  it("aplica o que está em Configurações, menos as filas fixadas por quem chamou", () => {
    const workers = [
      { name: "ingest", concurrency: 2 },
      { name: "ocr", concurrency: 1 },
      { name: "extract", concurrency: 2 },
    ];
    expect(applyConcurrency(workers, { ingest: 2, ocr: 3, extract: 4 }, { extract: 1 })).toEqual([
      "ocr",
      "extract",
    ]);
    expect(workers.map((w) => w.concurrency)).toEqual([2, 3, 1]);
    expect(applyConcurrency(workers, { ingest: 2, ocr: 3, extract: 4 }, { extract: 1 })).toEqual(
      [],
    );
  });
});
