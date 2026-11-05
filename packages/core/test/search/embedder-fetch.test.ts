import { afterEach, describe, expect, it } from "vitest";
import { asGlobalResponse } from "../../src/search/embedder";

/**
 * R6 (2026-11-04): o `@hono/node-server` troca o `Response` global pela classe dele; o `fetch` do Node devolve o
 * nativo, e o transformers.js só grava no cache o que é `instanceof Response` (sem gravar, "Unable to get model file
 * path or buffer"). O fetch do vetorizador reembrulha a resposta na classe global do momento.
 */
const Original = globalThis.Response;
afterEach(() => {
  globalThis.Response = Original;
});

describe("asGlobalResponse", () => {
  it("com o Response global trocado, devolve uma instância da classe global, com status, cabeçalhos e corpo", async () => {
    class Swapped extends Original {}
    const native = new Original("conteúdo do modelo", {
      status: 200,
      headers: { "content-length": "18" },
    });
    globalThis.Response = Swapped as typeof Response;
    expect(native instanceof globalThis.Response).toBe(false);
    const r = asGlobalResponse(native);
    expect(r instanceof globalThis.Response).toBe(true);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe("18");
    expect(await r.text()).toBe("conteúdo do modelo");
  });

  it("sem troca, devolve a mesma resposta", () => {
    const native = new Original("x");
    expect(asGlobalResponse(native)).toBe(native);
  });
});
