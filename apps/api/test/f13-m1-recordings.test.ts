import { seedFixture } from "@narnia-jobs/core";
import type { Recording } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F13/M1.4 · API do envio em partes, retomada, reprodução com Range e apagar (R5, R6, F13-2). */

const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const chunk = (bytes: Uint8Array) => ({
  method: "PUT",
  headers: { "content-type": "application/octet-stream" },
  body: bytes,
});
const read = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

describe("F13/M1.4 · /api/recordings", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function created(size = 10) {
    t = makeTestApp();
    const { profileId } = seedFixture(t.repos, "engineer");
    const res = await t.api(
      "/api/recordings",
      json({ profileId, fileName: "call.webm", size, mime: "video/webm" }),
    );
    expect(res.status).toBe(201);
    return { profileId, rec: await read<Recording>(res) };
  }

  it("cria, envia em duas partes, retoma e reproduz com Range", async () => {
    const { rec, profileId } = await created(10);
    const api = (t as TestApp).api;
    const first = await api(
      `/api/recordings/${rec.id}/video?offset=0`,
      chunk(new Uint8Array([0, 1, 2, 3, 4, 5])),
    );
    expect(first.status).toBe(200);
    expect(await read<Recording>(first)).toMatchObject({ received: 6, state: "uploading" });

    // a aba fechou: o navegador pergunta onde parou e retoma dali
    const again = await api(`/api/recordings/${rec.id}`);
    expect((await read<Recording>(again)).received).toBe(6);
    const wrong = await api(`/api/recordings/${rec.id}/video?offset=0`, chunk(new Uint8Array([9])));
    expect(wrong.status).toBe(409);
    expect(await read(wrong)).toMatchObject({
      error: { code: "offset_mismatch", details: { received: 6 } },
    });

    const last = await api(
      `/api/recordings/${rec.id}/video?offset=6`,
      chunk(new Uint8Array([6, 7, 8, 9])),
    );
    expect(await read<Recording>(last)).toMatchObject({
      received: 10,
      state: "uploaded",
      hasVideo: true,
    });

    const full = await api(`/api/recordings/${rec.id}/video`);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/webm");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect([...new Uint8Array(await full.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const part = await api(`/api/recordings/${rec.id}/video`, { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4]);

    const list = await read<{ recordings: Recording[] }>(
      api(`/api/recordings?profileId=${profileId}`),
    );
    expect(list.recordings.map((r) => r.id)).toEqual([rec.id]);
  });

  it("vídeo ainda em envio não reproduz", async () => {
    const { rec } = await created(10);
    expect((await (t as TestApp).api(`/api/recordings/${rec.id}/video`)).status).toBe(404);
  });

  it("recusas com código e status próprios", async () => {
    t = makeTestApp();
    const { profileId } = seedFixture(t.repos, "engineer");
    const post = (b: unknown) => (t as TestApp).api("/api/recordings", json(b));
    expect((await post({ profileId, fileName: "cv.pdf", size: 10 })).status).toBe(415);
    expect((await post({ profileId, fileName: "a.mp4", size: 50 * 1024 ** 3 })).status).toBe(413);
    expect((await post({ fileName: "a.mp4", size: 10 })).status).toBe(400);
    expect((await post({ profileId, fileName: "a.mp4" })).status).toBe(400);
    expect((await (t as TestApp).api("/api/recordings/nada")).status).toBe(404);
    const big = await (t as TestApp).api(
      "/api/recordings/nada/video?offset=0",
      chunk(new Uint8Array(9 * 1024 * 1024)),
    );
    expect(big.status).toBe(413);
  });

  it("apagar só o vídeo mantém a entrevista; apagar tudo some", async () => {
    const { rec } = await created(2);
    const api = (t as TestApp).api;
    await api(`/api/recordings/${rec.id}/video?offset=0`, chunk(new Uint8Array([1, 2])));
    const del = await api(`/api/recordings/${rec.id}/video`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await read<Recording>(del)).hasVideo).toBe(false);
    expect((await api(`/api/recordings/${rec.id}/video`)).status).toBe(404);
    expect((await api(`/api/recordings/${rec.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/recordings/${rec.id}`)).status).toBe(404);
  });
});
