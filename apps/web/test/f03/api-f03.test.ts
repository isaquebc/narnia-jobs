import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/lib/api";

function recorder(body: unknown = {}, status = 200) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { api: createApiClient({ fetch }), calls };
}

describe("F03/M4 · cliente de API da ingestão, GitHub e notificações", () => {
  it("GitHub: status, origem, fluxo de dispositivo, desconectar e preview", async () => {
    const { api, calls } = recorder();
    await api.getGithubAuth();
    await api.setGithubAuthSource("app");
    await api.startGithubDevice();
    await api.disconnectGithub();
    await api.previewGithub({ mode: "public", login: "ana-exemplo" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/github/auth",
      "PUT /api/github/auth",
      "POST /api/github/auth/device",
      "DELETE /api/github/auth",
      "POST /api/sources/github/preview",
    ]);
    expect(calls[1]?.body).toEqual({ source: "app" });
    expect(calls[4]?.body).toEqual({ mode: "public", login: "ana-exemplo" });
  });

  it("execuções: estimar, criar, listar por status, confirmar, decidir, cancelar, tentar de novo", async () => {
    const { api, calls } = recorder({ runs: [] });
    const body = {
      source: "github" as const,
      mode: "private" as const,
      repos: ["ana-exemplo/api"],
      depth: "balanced" as const,
      model: "haiku",
    };
    await api.estimateIngestion(body);
    await api.createGithubIngestion(body);
    await api.listIngestions({ status: ["awaiting_decision", "paused"] });
    await api.confirmIngestion("r1");
    await api.decideIngestion("r1", { action: "continue", extraBudget: 5000 });
    await api.cancelIngestion("r1");
    await api.retryIngestion("r1");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/ingestions/estimate",
      "POST /api/ingestions",
      "GET /api/ingestions?status=awaiting_decision%2Cpaused",
      "POST /api/ingestions/r1/confirm",
      "POST /api/ingestions/r1/decision",
      "POST /api/ingestions/r1/cancel",
      "POST /api/ingestions/r1/retry",
    ]);
    expect(calls[4]?.body).toEqual({ action: "continue", extraBudget: 5000 });
  });

  it("notificações, plano, configurações, repositórios, snapshots e digest de arquivo", async () => {
    const { api, calls } = recorder();
    await api.listNotifications("all");
    await api.readNotification("n1");
    await api.dismissNotification("n1");
    await api.getPlanUsage();
    await api.getIngestSettings();
    await api.putIngestSettings({ autoConfirmBelow: 0 });
    await api.listRepos();
    await api.getRepo("rp1");
    await api.putRepoDigest("rp1", {
      summary: "x",
      keyPoints: [],
      sections: [],
      meta: { language: "pt" },
    } as never);
    await api.reanalyzeRepo("rp1", { kind: "cover" });
    await api.listSnapshots();
    await api.deleteSnapshot("s1");
    await api.getFileDigest("f1");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/notifications?status=all",
      "POST /api/notifications/n1/read",
      "POST /api/notifications/n1/dismiss",
      "GET /api/plan/usage",
      "GET /api/settings/ingest",
      "PUT /api/settings/ingest",
      "GET /api/repos",
      "GET /api/repos/rp1",
      "PUT /api/repos/rp1/digest",
      "POST /api/repos/rp1/reanalyze",
      "GET /api/snapshots",
      "DELETE /api/snapshots/s1",
      "GET /api/files/f1/digest",
    ]);
    expect(calls[9]?.body).toEqual({ kind: "cover" });
  });
});
