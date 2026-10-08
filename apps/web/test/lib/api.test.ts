import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../../src/lib/api";

function fetchMock(
  status: number,
  body: unknown,
  capture?: (init: RequestInit, url: string) => void,
) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(init ?? {}, String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("lib/api · cliente tipado", () => {
  it("envia o token como Bearer e decodifica a resposta", async () => {
    let seen: { init: RequestInit; url: string } | null = null;
    const api = createApiClient({
      fetch: fetchMock(
        200,
        {
          installed: true,
          loggedIn: true,
          authMethod: "claude.ai",
          version: "2.1",
          loginHint: null,
        },
        (init, url) => {
          seen = { init, url };
        },
      ),
      getToken: () => "abc",
    });
    const status = await api.getProviderStatus();
    expect(status.loggedIn).toBe(true);
    expect(seen).not.toBeNull();
    const headers = new Headers((seen as unknown as { init: RequestInit }).init.headers);
    expect(headers.get("authorization")).toBe("Bearer abc");
    expect((seen as unknown as { url: string }).url).toBe("/api/provider/status");
  });

  it("lança ApiError com código e mensagem do servidor", async () => {
    const api = createApiClient({
      fetch: fetchMock(401, {
        error: { code: "unauthorized", message: "Token ausente ou inválido" },
      }),
      getToken: () => null,
    });
    await expect(api.getOnboardingState()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "unauthorized",
      message: "Token ausente ou inválido",
    });
  });

  it("lança ApiError 'network' quando o fetch falha", async () => {
    const api = createApiClient({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      getToken: () => null,
    });
    const err = await api.getHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("network");
  });

  it("envia upload como multipart no campo `file`", async () => {
    let body: FormData | null = null;
    const api = createApiClient({
      fetch: fetchMock(
        201,
        {
          id: "f1",
          kind: "cv",
          originalName: "cv.pdf",
          mime: "application/pdf",
          size: 3,
          pages: 1,
          uploadedAt: "2026-10-07T00:00:00.000Z",
        },
        (init) => {
          body = init.body as FormData;
        },
      ),
      getToken: () => "t",
    });
    const file = new File([new Uint8Array([1, 2, 3])], "cv.pdf", { type: "application/pdf" });
    const res = await api.uploadFile(file);
    expect(res.id).toBe("f1");
    expect(body).toBeInstanceOf(FormData);
    expect((body as unknown as FormData).get("file")).toBeInstanceOf(File);
  });

  it("monta a query da estimativa com as opções", async () => {
    let url = "";
    const api = createApiClient({
      fetch: fetchMock(200, { calls: [], totalTokens: 0, labels: {}, options: {} }, (_i, u) => {
        url = u;
      }),
      getToken: () => "t",
    });
    await api.getEstimate("f1", { ocr: false, modelRead: true });
    expect(url).toBe("/api/files/f1/estimate?ocr=false&modelRead=true");
  });
});
