import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { annotateSpan, getTracer, setTracer, startSpan, withSpan } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { errorForTrace, initTelemetry, shutdownTelemetry } from "../../src/telemetry/otel";

/** F04/M5 · exportador OTLP só com NARNIA_OTEL_ENDPOINT; sem ele, nada é carregado nem enviado (§6.5). */
describe("F04/M5 · OpenTelemetry", () => {
  afterEach(async () => {
    await shutdownTelemetry();
    setTracer(null);
  });

  it("sem NARNIA_OTEL_ENDPOINT não inicia exportador e a fachada segue no-op", async () => {
    expect(await initTelemetry({}, "narnia-api")).toBe(false);
    expect(getTracer()).toBeNull();
  });

  it("com endpoint, spans saem por OTLP/HTTP para o coletor (Phoenix)", async () => {
    const received: Array<{ url: string; type: string }> = [];
    const server = createServer((req: IncomingMessage, res) => {
      req.resume();
      req.on("end", () => {
        received.push({ url: req.url ?? "", type: String(req.headers["content-type"]) });
        res.writeHead(200, { "content-type": "application/x-protobuf" });
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const ok = await initTelemetry(
        { NARNIA_OTEL_ENDPOINT: `http://127.0.0.1:${port}/v1/traces` },
        "narnia-api",
      );
      expect(ok).toBe(true);
      expect(getTracer()).not.toBeNull();
      const s = startSpan("chat.turn", { "narnia.session_id": "s1" });
      s.end();
      await shutdownTelemetry();
      expect(received.some((r) => r.url === "/v1/traces")).toBe(true);
      expect(received[0]?.type).toContain("protobuf");
    } finally {
      server.close();
    }
  });

  it("filho no mesmo rastro, ids hex e anotações e nota no Phoenix depois do span chegar (404 = tenta de novo)", async () => {
    const posts: Array<{ url: string; body: string }> = [];
    let annotationTries = 0;
    const server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const url = req.url ?? "";
        if (url.startsWith("/v1/traces")) {
          res.writeHead(200, { "content-type": "application/x-protobuf" });
          res.end();
          return;
        }
        posts.push({ url, body: Buffer.concat(chunks).toString("utf8") });
        if (url.startsWith("/v1/span_annotations") && annotationTries++ === 0) {
          res.writeHead(404);
          res.end("Spans with IDs x do not exist.");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      await initTelemetry(
        { NARNIA_OTEL_ENDPOINT: `http://127.0.0.1:${port}/v1/traces`, NARNIA_OTEL_RETRY_MS: "5" },
        "narnia-api",
      );
      const root = startSpan("chat.turn");
      const child = startSpan("llm", {}, { parent: root, startTime: Date.now() - 50 });
      expect(root.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(child.traceId).toBe(root.traceId);
      expect(child.spanId).not.toBe(root.spanId);
      child.end();
      root.end();
      annotateSpan(
        root,
        [{ name: "within_budget", label: "passou", score: 1, explanation: "ok" }],
        "Turno 1 · 0 tools",
      );
      await shutdownTelemetry();
      const ann = posts.filter((p) => p.url.startsWith("/v1/span_annotations"));
      expect(ann).toHaveLength(2);
      expect(JSON.parse(ann[1]?.body ?? "{}")).toEqual({
        data: [
          {
            span_id: root.spanId,
            name: "within_budget",
            annotator_kind: "CODE",
            identifier: "narnia",
            result: { label: "passou", score: 1, explanation: "ok" },
          },
        ],
      });
      const note = posts.find((p) => p.url.startsWith("/v1/span_notes"));
      expect(JSON.parse(note?.body ?? "{}")).toEqual({
        data: { span_id: root.spanId, note: "Turno 1 · 0 tools", identifier: "narnia" },
      });
    } finally {
      server.close();
    }
  });

  it("span aberto dentro de withSpan herda o pai pelo contexto assíncrono (job do worker → chamada ao modelo)", async () => {
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => res.end());
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    await initTelemetry(
      { NARNIA_OTEL_ENDPOINT: `http://127.0.0.1:${port}/v1/traces` },
      "narnia-worker",
    );
    let job: { traceId?: string; spanId?: string } = {};
    let inner: { traceId?: string } = {};
    await withSpan("job.extract", {}, async (s) => {
      job = s;
      await new Promise((r) => setTimeout(r, 1));
      inner = startSpan("llm.structured");
    });
    const outside = startSpan("solto");
    expect(inner.traceId).toBe(job.traceId);
    expect(outside.traceId).not.toBe(job.traceId);
    await shutdownTelemetry();
    server.close();
  });

  describe("erro no span sem conteúdo (auditoria E2, 19e)", () => {
    const leak = new Error(
      'Saída fora do schema: {"summary":"Ana liderou a migração do Banco X","phone":"+55 11 99999-0000"}',
    );

    it("com NARNIA_OTEL_CONTENT desligado, só o começo da mensagem (até ':') vai para o rastro, sem stack", () => {
      const e = errorForTrace(leak, false);
      expect(e.message).toBe("Saída fora do schema (conteúdo omitido; NARNIA_OTEL_CONTENT=0)");
      expect(e.name).toBe("Error");
      expect(JSON.stringify(e)).not.toMatch(/Banco X|99999/);
      expect(e.stack).toBeUndefined();
    });

    it("mensagem longa sem ':' é cortada em 120 caracteres; texto não-Error vira mensagem genérica", () => {
      const e = errorForTrace(new Error("x".repeat(500)), false);
      expect(e.message.startsWith("x".repeat(120))).toBe(true);
      expect(e.message).not.toContain("x".repeat(121));
      expect(errorForTrace("resposta crua do modelo", false).message).toBe(
        "erro (conteúdo omitido; NARNIA_OTEL_CONTENT=0)",
      );
    });

    it("com NARNIA_OTEL_CONTENT=1 a mensagem segue inteira", () => {
      expect(errorForTrace(leak, true).message).toBe(leak.message);
    });
  });
});
