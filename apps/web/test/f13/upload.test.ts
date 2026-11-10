import type { Recording } from "@narnia-jobs/shared";
import { describe, expect, it, vi } from "vitest";
import { uploadRecording } from "../../src/features/recordings/upload";
import { ApiError } from "../../src/lib/api";

/**
 * F13/M1.5 · envio do vídeo em partes pelo navegador (R5): começa de onde o servidor parou, segue o `received` que o
 * servidor devolve no `offset_mismatch`, tenta de novo depois de queda de rede e para com erro definitivo.
 */
const rec = (over: Partial<Recording> = {}): Recording => ({
  id: "r1",
  profileId: "p1",
  jobApplicationId: null,
  stageId: null,
  title: null,
  state: "uploading",
  fileName: "call.webm",
  mime: "video/webm",
  size: 20,
  received: 0,
  hasVideo: false,
  durationS: null,
  error: null,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  ...over,
});
const file = (n = 20) => new File([new Uint8Array(n).map((_, i) => i)], "call.webm");

/** Servidor falso: guarda os bytes e confere o offset como o api. */
function server(start = 0) {
  let received = start;
  const bytes: number[] = Array.from({ length: start }, (_, i) => i);
  const putRecordingChunk = vi.fn(async (_id: string, offset: number, blob: Blob) => {
    if (offset !== received)
      throw new ApiError(409, "offset_mismatch", "Parte fora de ordem.", { received });
    bytes.push(...new Uint8Array(await blob.arrayBuffer()));
    received += blob.size;
    return rec({ received, state: received === 20 ? "uploaded" : "uploading" });
  });
  return { putRecordingChunk, bytes: () => bytes };
}
const noSleep = async () => {};

describe("F13/M1.5 · envio em partes", () => {
  it("manda as partes em ordem e informa o progresso", async () => {
    const s = server();
    const progress: number[] = [];
    const done = await uploadRecording(s, rec(), file(), {
      chunkBytes: 8,
      onProgress: (p) => progress.push(p),
      sleep: noSleep,
    });
    expect(done.state).toBe("uploaded");
    expect(s.putRecordingChunk.mock.calls.map((c) => c[1])).toEqual([0, 8, 16]);
    expect(s.bytes()).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(progress).toEqual([8, 16, 20]);
  });

  it("retoma de onde o servidor parou (aba fechada e o mesmo arquivo escolhido de novo)", async () => {
    const s = server(8);
    await uploadRecording(s, rec({ received: 8 }), file(), { chunkBytes: 8, sleep: noSleep });
    expect(s.putRecordingChunk.mock.calls.map((c) => c[1])).toEqual([8, 16]);
    expect(s.bytes()).toHaveLength(20);
  });

  it("segue o received do offset_mismatch (resposta perdida)", async () => {
    const s = server(16);
    await uploadRecording(s, rec({ received: 8 }), file(), { chunkBytes: 8, sleep: noSleep });
    expect(s.putRecordingChunk.mock.calls.map((c) => c[1])).toEqual([8, 16]);
  });

  it("queda de rede: espera e tenta de novo; erro definitivo para", async () => {
    const s = server();
    const real = s.putRecordingChunk.getMockImplementation();
    s.putRecordingChunk.mockImplementationOnce(async () => {
      throw new ApiError(0, "network", "Falha de rede");
    });
    const sleep = vi.fn(noSleep);
    const done = await uploadRecording(s, rec(), file(), { chunkBytes: 8, sleep });
    expect(done.received).toBe(20);
    expect(sleep).toHaveBeenCalledTimes(1);

    const bad = server();
    bad.putRecordingChunk.mockImplementation(async () => {
      throw new ApiError(400, "invalid", "A parte passa do tamanho declarado do vídeo.");
    });
    await expect(
      uploadRecording(bad, rec(), file(), { chunkBytes: 8, sleep: noSleep }),
    ).rejects.toThrow(/tamanho declarado/);
    expect(real).toBeDefined();
  });

  it("arquivo diferente do que começou a ser enviado é recusado antes de mandar", async () => {
    const s = server(8);
    await expect(
      uploadRecording(s, rec({ received: 8 }), file(19), { chunkBytes: 8, sleep: noSleep }),
    ).rejects.toMatchObject({ code: "different_file" });
    expect(s.putRecordingChunk).not.toHaveBeenCalled();
  });

  it("cancelar interrompe entre as partes", async () => {
    const s = server();
    const ctl = new AbortController();
    s.putRecordingChunk.mockImplementationOnce(async (_id, _o, blob: Blob) => {
      ctl.abort();
      return rec({ received: blob.size });
    });
    await expect(
      uploadRecording(s, rec(), file(), { chunkBytes: 8, sleep: noSleep, signal: ctl.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(s.putRecordingChunk).toHaveBeenCalledTimes(1);
  });
});
