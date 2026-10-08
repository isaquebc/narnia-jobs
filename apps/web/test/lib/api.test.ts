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

describe("lib/api · rotas de perfil (F02)", () => {
  it("monta método e caminho de cada rota nova", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = createApiClient({
      fetch: fetchMock(200, { ok: true }, (init, url) => {
        calls.push({
          method: init.method ?? "GET",
          url,
          body: typeof init.body === "string" ? JSON.parse(init.body) : null,
        });
      }),
      getToken: () => null,
    });
    await api.listProfiles({ archived: true });
    await api.getProfile("p1");
    await api.patchProfile("p1", { pitch: "x" });
    await api.activateProfile("p1");
    await api.archiveProfile("p1");
    await api.unarchiveProfile("p1");
    await api.getProfileCard("p1");
    await api.rebuildProfileCard("p1");
    await api.getEmphasis("p1");
    await api.putEmphasis("p1", { items: [{ kind: "skill", id: "s1", mode: "highlight" }] });
    await api.getPersona("p1");
    await api.putPersona("p1", { tone: null });
    await api.listSuggestions();
    await api.dismissSuggestion("sg1");
    await api.getAnalyzeEstimate();
    await api.analyzeProfiles({});
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/profiles?archived=1",
      "GET /api/profiles/p1",
      "PATCH /api/profiles/p1",
      "PUT /api/profiles/p1/activate",
      "POST /api/profiles/p1/archive",
      "POST /api/profiles/p1/unarchive",
      "GET /api/profiles/p1/card",
      "POST /api/profiles/p1/card/rebuild",
      "GET /api/profiles/p1/emphasis",
      "PUT /api/profiles/p1/emphasis",
      "GET /api/profiles/p1/persona",
      "PUT /api/profiles/p1/persona",
      "GET /api/profiles/suggestions",
      "POST /api/profiles/suggestions/sg1/dismiss",
      "GET /api/profiles/analyze/estimate",
      "POST /api/profiles/analyze",
    ]);
    expect(calls[11]?.body).toEqual({ tone: null });
  });
});
