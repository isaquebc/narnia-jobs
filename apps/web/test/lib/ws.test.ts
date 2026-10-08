import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWsClient } from "../../src/lib/ws";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("lib/ws · cliente com reconexão e fila", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it("entrega eventos válidos aos ouvintes e ignora payload inválido", () => {
    const client = createWsClient({ url: "ws://x/ws", factory: (u) => new FakeSocket(u) });
    const seen: unknown[] = [];
    client.subscribe((e) => seen.push(e));
    client.connect();
    const s = FakeSocket.instances[0] as FakeSocket;
    s.open();
    s.message({ type: "job.done", jobId: "j1" });
    s.onmessage?.({ data: "{nope" });
    s.message({ type: "unknown" });
    expect(seen).toEqual([{ type: "job.done", jobId: "j1" }]);
  });

  it("guarda eventos recebidos antes do primeiro ouvinte e os entrega na inscrição", () => {
    const client = createWsClient({ url: "ws://x/ws", factory: (u) => new FakeSocket(u) });
    client.connect();
    const s = FakeSocket.instances[0] as FakeSocket;
    s.open();
    s.message({ type: "job.progress", jobId: "j1", stage: "ocr.pages", progress: 50 });
    const seen: unknown[] = [];
    client.subscribe((e) => seen.push(e));
    expect(seen).toHaveLength(1);
  });

  it("reconecta com backoff após fechar e para em close()", () => {
    const client = createWsClient({
      url: "ws://x/ws",
      factory: (u) => new FakeSocket(u),
      backoffMs: [100, 200],
    });
    const states: string[] = [];
    client.onStatus((st) => states.push(st));
    client.connect();
    (FakeSocket.instances[0] as FakeSocket).open();
    (FakeSocket.instances[0] as FakeSocket).close();
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(2);
    (FakeSocket.instances[1] as FakeSocket).close();
    vi.advanceTimersByTime(200);
    expect(FakeSocket.instances).toHaveLength(3);
    client.close();
    (FakeSocket.instances[2] as FakeSocket).close();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(states).toContain("open");
    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("closed");
  });
});
