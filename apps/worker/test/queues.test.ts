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
