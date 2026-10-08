import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EventBus } from "../src/events";
import { createRelayHandler } from "../src/relay";
import { attachWebSocket } from "../src/ws";

describe("M4/api WebSocket /ws e relay do Redis", () => {
  let server: ReturnType<typeof createServer> | null = null;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  it("cliente autenticado por ?token recebe os eventos do bus; sem token a conexão é fechada com 4401", async () => {
    const bus = new EventBus();
    server = createServer((_req, res) => res.end("ok"));
    attachWebSocket({ server, bus, token: "tk" });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tk`);
    await new Promise<void>((r) => ws.once("open", () => r()));
    const received = new Promise<string>((r) => ws.once("message", (m) => r(m.toString())));
    bus.emit({ type: "job.progress", jobId: "j1", stage: "extract.facts", progress: 50 });
    expect(JSON.parse(await received)).toEqual({
      type: "job.progress",
      jobId: "j1",
      stage: "extract.facts",
      progress: 50,
    });
    ws.close();

    const anon = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((r) => anon.once("close", (c) => r(c)));
    expect(code).toBe(4401);
  });

  it("relay valida e repassa mensagens do canal; ignora JSON inválido e duplicatas consecutivas", () => {
    const bus = new EventBus();
    const got: unknown[] = [];
    bus.on((e) => got.push(e));
    const onMessage = createRelayHandler(bus);
    const ev = JSON.stringify({ type: "job.done", jobId: "j1" });
    onMessage(ev);
    onMessage(ev); // duplicata consecutiva
    onMessage("{nope");
    onMessage(JSON.stringify({ type: "desconhecido" }));
    onMessage(JSON.stringify({ type: "job.error", jobId: "j1", error: "x" }));
    onMessage(ev); // mesma mensagem, mas não consecutiva: passa
    expect(got).toEqual([
      { type: "job.done", jobId: "j1" },
      { type: "job.error", jobId: "j1", error: "x" },
      { type: "job.done", jobId: "j1" },
    ]);
  });
});
