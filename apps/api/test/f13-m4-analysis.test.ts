import { cpSync } from "node:fs";
import { join } from "node:path";
import {
  importMediaResults,
  MediaClient,
  RECORDING_TASKS,
  recordingDir,
  seedFixture,
} from "@narnia-jobs/core";
import type { Recording, RecordingAnalysis } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F13/M4 · API da análise: começa sozinha ao terminar o envio (com o media no ar), recusa com ele desligado, mostra a
 * análise, corrige pessoa e turno, serve os quadros e refaz o relatório.
 */
const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "core",
  "test",
  "fixtures",
  "recording-work",
);
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

/** media no ar (estado `needs_token`): só o /health importa aqui. */
const mediaUp = () =>
  new MediaClient(
    "http://media:8700",
    (async () =>
      new Response(
        JSON.stringify({ ok: true, version: "1", token: false, busy: false, steps: [] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch,
  );

describe("F13/M4 · análise pela API", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function uploaded(media?: MediaClient) {
    t = makeTestApp(media ? { media } : {});
    const { profileId } = seedFixture(t.repos, "engineer");
    t.repos.users.upsert({ fullName: "Alex Souza" });
    const rec = await read<Recording>(
      t.api("/api/recordings", json({ profileId, fileName: "call.webm", size: 2 })),
    );
    const done = await read<Recording>(
      t.api(`/api/recordings/${rec.id}/video?offset=0`, chunk(new Uint8Array([1, 2]))),
    );
    return { rec: done, api: t.api, app: t };
  }

  it("o envio terminado enfileira a análise quando o media está no ar", async () => {
    const { rec, app } = await uploaded(mediaUp());
    expect(rec.state).toBe("analyzing");
    expect(app.queue.tasks).toEqual([
      expect.objectContaining({
        queue: "media",
        type: RECORDING_TASKS.analyze,
        payload: { recordingId: rec.id },
      }),
    ]);
  });

  it("media desligado: o envio fica pronto e analisar devolve 409 com o comando", async () => {
    const { rec, api, app } = await uploaded();
    expect(rec.state).toBe("uploaded");
    expect(app.queue.tasks).toEqual([]);
    const res = await api(`/api/recordings/${rec.id}/analyze`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await read(res)).toMatchObject({ error: { code: "media_off" } });
  });

  it("análise, correções, quadros e refazer o relatório", async () => {
    const { rec, api, app } = await uploaded();
    cpSync(FIXTURE, join(recordingDir(app.dataDir, rec.id), "work"), { recursive: true });
    importMediaResults(app.repos, app.dataDir, rec.id);
    const a = await read<RecordingAnalysis>(api(`/api/recordings/${rec.id}/analysis`));
    expect(a.persons.map((p) => p.name)).toEqual(["Marina Duarte", "Alex Souza"]);
    const [marina, alex] = a.persons;
    if (!marina || !alex) throw new Error("sem pessoas");

    const p = await api(
      `/api/recordings/${rec.id}/persons/${marina.id}`,
      json({ name: "Marina" }, "PATCH"),
    );
    expect(await read(p)).toMatchObject({ name: "Marina", nameSource: "user" });
    const turn = a.turns[1];
    if (!turn) throw new Error("sem turnos");
    const tt = await api(
      `/api/recordings/${rec.id}/turns/${turn.id}`,
      json({ personId: marina.id }, "PATCH"),
    );
    expect(await read(tt)).toMatchObject({ personId: marina.id, corrected: true });
    expect(
      (await api(`/api/recordings/${rec.id}/turns/${turn.id}`, json({ personId: "x" }, "PATCH")))
        .status,
    ).toBe(400);

    const frame = a.frames[0];
    if (!frame) throw new Error("sem quadros");
    const img = await api(`/api/recordings/${rec.id}/frames/${frame.file}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect((await api(`/api/recordings/${rec.id}/frames/..%2Fvideo.webm`)).status).toBe(404);

    const again = await api(`/api/recordings/${rec.id}/report`, { method: "POST" });
    expect(again.status).toBe(202);
    expect(app.queue.tasks.at(-1)).toMatchObject({
      queue: "extract",
      type: RECORDING_TASKS.report,
    });
  });
});
