import { describe, expect, it } from "vitest";
import { MEDIA_ENABLE_COMMAND, MediaClient, MediaError } from "../../src/media/client";

/** F13/M1.2 · cliente do serviço media (R2, R4): estado, token e execuções, com `fetch` falso. */

type Call = { url: string; method: string; body: unknown };

function fakeFetch(
  routes: Record<string, (body: unknown) => [number, unknown]>,
  calls: Call[] = [],
) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const route = routes[`${method} ${new URL(url).pathname}`];
    if (!route) throw new TypeError("fetch failed");
    const [status, out] = route(body);
    return new Response(JSON.stringify(out), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const health = (token: boolean) => () =>
  [200, { ok: true, version: "0.1.0", token, busy: false, steps: ["probe"] }] as [number, unknown];

describe("F13/M1.2 · MediaClient", () => {
  it("sem URL = desligado, sem chamar nada", async () => {
    const calls: Call[] = [];
    const c = new MediaClient(null, fakeFetch({}, calls));
    expect(await c.status()).toEqual({
      state: "off",
      enableCommand: MEDIA_ENABLE_COMMAND,
      version: null,
      busy: false,
      steps: [],
    });
    expect(calls).toEqual([]);
  });

  it("serviço fora do ar = desligado", async () => {
    const c = new MediaClient("http://media:8700", fakeFetch({}));
    expect((await c.status()).state).toBe("off");
  });

  it("no ar sem token = needs_token; com token = ready", async () => {
    const off = new MediaClient("http://media:8700", fakeFetch({ "GET /health": health(false) }));
    expect(await off.status()).toMatchObject({ state: "needs_token", version: "0.1.0" });
    const on = new MediaClient("http://media:8700/", fakeFetch({ "GET /health": health(true) }));
    expect(await on.status()).toMatchObject({ state: "ready", steps: ["probe"] });
  });

  it("grava o token e devolve só a confirmação", async () => {
    const calls: Call[] = [];
    const c = new MediaClient(
      "http://media:8700",
      fakeFetch({ "PUT /token": () => [200, { configured: true }] }, calls),
    );
    await c.setToken("  hf_abc123  ");
    expect(calls[0]).toMatchObject({
      url: "http://media:8700/token",
      body: { token: "hf_abc123" },
    });
  });

  it("token recusado vira MediaError com a mensagem do serviço, sem o token", async () => {
    const c = new MediaClient(
      "http://media:8700",
      fakeFetch({
        "PUT /token": () => [422, { error: "token_rejected", message: "Aceite os termos." }],
      }),
    );
    const err = await c.setToken("hf_segredo999").catch((e) => e);
    expect(err).toBeInstanceOf(MediaError);
    expect(err).toMatchObject({
      code: "token_rejected",
      status: 422,
      message: "Aceite os termos.",
    });
    expect(JSON.stringify(err)).not.toContain("hf_segredo999");
    expect(String(err.stack)).not.toContain("hf_segredo999");
  });

  it("gravar token com o serviço fora do ar = media_off", async () => {
    const c = new MediaClient("http://media:8700", fakeFetch({}));
    await expect(c.setToken("hf_abc")).rejects.toMatchObject({ code: "media_off", status: 503 });
    const none = new MediaClient(null, fakeFetch({}));
    await expect(none.setToken("hf_abc")).rejects.toMatchObject({ code: "media_off" });
  });

  it("execuções: cria e consulta; ocupado devolve o id da que está rodando", async () => {
    const calls: Call[] = [];
    const c = new MediaClient(
      "http://media:8700",
      fakeFetch(
        {
          "POST /runs": () => [202, { id: "r1" }],
          "GET /runs/r1": () => [200, { id: "r1", state: "running", step: "probe", progress: 0 }],
        },
        calls,
      ),
    );
    expect(await c.startRun("abc", ["probe"])).toEqual({ id: "r1" });
    expect(calls[0]?.body).toEqual({ interview_id: "abc", steps: ["probe"], options: {} });
    expect(await c.getRun("r1")).toMatchObject({ state: "running", step: "probe" });
    const busy = new MediaClient(
      "http://media:8700",
      fakeFetch({
        "POST /runs": () => [409, { error: "busy", message: "Ocupado.", run_id: "r0" }],
      }),
    );
    await expect(busy.startRun("abc", ["probe"])).rejects.toMatchObject({
      code: "busy",
      details: { runId: "r0" },
    });
  });
});
