import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MediaClient } from "@narnia-jobs/core";
import type { MediaStatus } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F13/M1.2 · Configurações › Análise de vídeo: estado do serviço media e token do Hugging Face (R2, R4). */

const SECRET = "hf_Segredo1234567890";

function fakeMedia(state: { token: boolean; up: boolean; reject?: string }) {
  const seen: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!state.up) throw new TypeError("fetch failed");
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    if (init?.body) seen.push(String(init.body));
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (method === "GET" && path === "/health")
      return json(200, {
        ok: true,
        version: "0.1.0",
        token: state.token,
        busy: false,
        steps: ["probe"],
      });
    if (method === "PUT" && path === "/token") {
      if (state.reject) return json(422, { error: "token_rejected", message: state.reject });
      state.token = true;
      return json(200, { configured: true });
    }
    if (method === "DELETE" && path === "/token") {
      state.token = false;
      return json(200, { configured: false });
    }
    return json(404, { error: "not_found" });
  }) as typeof fetch;
  return { client: new MediaClient("http://media:8700", f), seen };
}

const put = (token: string) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token }),
});

describe("F13/M1.2 · /api/media", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("desligado: estado off com o comando de ligar", async () => {
    t = makeTestApp({ media: fakeMedia({ token: false, up: false }).client });
    const res = await t.api("/api/media/status");
    expect(res.status).toBe(200);
    const s = (await res.json()) as MediaStatus;
    expect(s.state).toBe("off");
    expect(s.enableCommand).toBe("./start.sh media on");
  });

  it("no ar: needs_token → grava → ready; o token não volta nem vai para o log", async () => {
    const media = fakeMedia({ token: false, up: true });
    t = makeTestApp({ media: media.client });
    expect(((await (await t.api("/api/media/status")).json()) as MediaStatus).state).toBe(
      "needs_token",
    );
    const res = await t.api("/api/media/token", put(SECRET));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toMatchObject({ state: "ready" });
    expect(media.seen.join()).toContain(SECRET); // chegou ao media, e só lá
    const logs = readdirSync(join(t.dataDir, "logs"), { recursive: true })
      .map((f) => join(t?.dataDir ?? "", "logs", String(f)))
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => readFileSync(f, "utf8"))
      .join();
    expect(logs).not.toContain(SECRET);
    expect((await t.api("/api/media/token", { method: "DELETE" })).status).toBe(200);
    expect(((await (await t.api("/api/media/status")).json()) as MediaStatus).state).toBe(
      "needs_token",
    );
  });

  it("token recusado: 422 com a mensagem acionável, sem o token", async () => {
    t = makeTestApp({
      media: fakeMedia({ token: false, up: true, reject: "Aceite os termos do modelo." }).client,
    });
    const res = await t.api("/api/media/token", put(SECRET));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "token_rejected", message: "Aceite os termos do modelo." },
    });
  });

  it("token com o serviço desligado: 503 media_off", async () => {
    t = makeTestApp({ media: fakeMedia({ token: false, up: false }).client });
    const res = await t.api("/api/media/token", put(SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "media_off" } });
  });

  it("corpo inválido: 400", async () => {
    t = makeTestApp({ media: fakeMedia({ token: false, up: true }).client });
    const res = await t.api("/api/media/token", put(""));
    expect(res.status).toBe(400);
  });
});
