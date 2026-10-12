import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { getTracer, setTracer, startSpan } from "@narnia-jobs/shared";
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
