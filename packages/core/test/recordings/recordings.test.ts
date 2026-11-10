import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECORDING_DISK_MARGIN_BYTES } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { applyToPosting, removeJobApplication } from "../../src/job-applications";
import {
  appendRecordingChunk,
  createRecording,
  RecordingError,
  recordingDir,
  recordingFramesDir,
  recordingVideoPath,
  removeRecording,
  removeRecordingVideo,
} from "../../src/recordings";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F13/M1.4 · entrevista gravada: criar no início do envio, partes em ordem com retomada, vídeo final em
 * `<dados>/interviews/<id>/video.<ext>` (fora do backup), apagar só o vídeo ou tudo (R5, F13-2).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GB = 1024 ** 3;
const now = new Date("2026-11-09T12:00:00.000Z");
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-rec-"));
  dirs.push(dataDir);
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const p = r.postings.create({ company: "Acme", title: "Backend" }, { source: "user" });
  const d = r.documents.create({
    kind: "cv",
    profileId,
    postingId: p.id,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const v = r.documents.addVersion(d.id, {
    source: "agent",
    instructions: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
  });
  r.documents.updateVersion(v.id, { status: "ready" });
  const app = applyToPosting(r, { postingId: p.id, cvVersionId: v.id, appliedOn: "2026-10-20" });
  r.jobApplications.setStages(app.id, [{ name: "RH" }, { name: "Técnica" }]);
  const withStages = r.jobApplications.get(app.id);
  if (!withStages) throw new Error("sem candidatura");
  return { r, dataDir, profileId, app: withStages };
}

const roomy = { freeBytes: 100 * GB, now };

describe("F13/M1.4 · criar a entrevista", () => {
  it("na etapa da candidatura: perfil vem da candidatura; estado uploading", () => {
    const { r, dataDir, app, profileId } = setup();
    const stageId = app.stages[1]?.id;
    const rec = createRecording(
      r,
      dataDir,
      {
        jobApplicationId: app.id,
        stageId,
        fileName: "Entrevista.MP4",
        size: 10,
        mime: "video/mp4",
      },
      roomy,
    );
    expect(rec).toMatchObject({
      profileId,
      jobApplicationId: app.id,
      stageId,
      state: "uploading",
      fileName: "Entrevista.MP4",
      size: 10,
      received: 0,
      hasVideo: false,
      durationS: null,
    });
    expect(r.recordings.listByApplication(app.id).map((x) => x.id)).toEqual([rec.id]);
  });

  it("avulso exige perfil; etapa de outra candidatura é recusada", () => {
    const { r, dataDir, app } = setup();
    const err = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e as RecordingError;
      }
      throw new Error("devia falhar");
    };
    expect(err(() => createRecording(r, dataDir, { fileName: "a.mp4", size: 1 }, roomy)).code).toBe(
      "invalid",
    );
    expect(
      err(() =>
        createRecording(
          r,
          dataDir,
          { jobApplicationId: app.id, stageId: "outra", fileName: "a.mp4", size: 1 },
          roomy,
        ),
      ).code,
    ).toBe("invalid");
    expect(
      err(() =>
        createRecording(
          r,
          dataDir,
          { jobApplicationId: "nao-existe", fileName: "a.mp4", size: 1 },
          roomy,
        ),
      ).code,
    ).toBe("not_found");
  });

  it("tipo, tamanho e disco: recusa antes de começar", () => {
    const { r, dataDir, profileId } = setup();
    const code = (input: Parameters<typeof createRecording>[2], free = 100 * GB) => {
      try {
        createRecording(r, dataDir, input, { freeBytes: free, now });
        return "ok";
      } catch (e) {
        expect(e).toBeInstanceOf(RecordingError);
        return (e as RecordingError).code;
      }
    };
    expect(code({ profileId, fileName: "notas.pdf", size: 10 })).toBe("unsupported_type");
    expect(code({ profileId, fileName: "sem-extensao", size: 10 })).toBe("unsupported_type");
    expect(code({ profileId, fileName: "a.webm", size: 5 * GB })).toBe("too_large");
    r.settings.set("recordings.limits", { maxBytes: 6 * GB });
    expect(code({ profileId, fileName: "a.webm", size: 5 * GB })).toBe("ok");
    expect(
      code({ profileId, fileName: "a.webm", size: GB }, GB + RECORDING_DISK_MARGIN_BYTES - 1),
    ).toBe("insufficient_storage");
  });
});

describe("F13/M1.4 · envio em partes", () => {
  it("partes em ordem; a última renomeia para video.<ext> e marca uploaded", () => {
    const { r, dataDir, profileId } = setup();
    const rec = createRecording(r, dataDir, { profileId, fileName: "call.webm", size: 10 }, roomy);
    const a = appendRecordingChunk(r, dataDir, rec.id, 0, bytes(6, 1), now);
    expect(a).toMatchObject({ received: 6, state: "uploading", hasVideo: false });
    expect(existsSync(join(recordingDir(dataDir, rec.id), "video.part"))).toBe(true);
    expect(recordingVideoPath(dataDir, a)).toBeNull();
    const b = appendRecordingChunk(r, dataDir, rec.id, 6, bytes(4, 2), now);
    expect(b).toMatchObject({ received: 10, state: "uploaded", hasVideo: true });
    const path = recordingVideoPath(dataDir, b);
    expect(path).toBe(join(dataDir, "interviews", rec.id, "video.webm"));
    expect([...readFileSync(path as string)]).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(existsSync(join(recordingDir(dataDir, rec.id), "video.part"))).toBe(false);
  });

  it("retomada: parte fora de ordem devolve quantos bytes já chegaram", () => {
    const { r, dataDir, profileId } = setup();
    const rec = createRecording(r, dataDir, { profileId, fileName: "call.mp4", size: 10 }, roomy);
    appendRecordingChunk(r, dataDir, rec.id, 0, bytes(4), now);
    try {
      appendRecordingChunk(r, dataDir, rec.id, 8, bytes(2), now);
      throw new Error("devia falhar");
    } catch (e) {
      expect(e).toMatchObject({ code: "offset_mismatch", details: { received: 4 } });
    }
    // reenvio da mesma parte (a resposta se perdeu): também é offset_mismatch, sem duplicar bytes
    expect(() => appendRecordingChunk(r, dataDir, rec.id, 0, bytes(4), now)).toThrow(
      RecordingError,
    );
    expect(r.recordings.get(rec.id)?.received).toBe(4);
  });

  it("parte que passa do tamanho declarado ou maior que 8 MB é recusada; depois de pronto, nada entra", () => {
    const { r, dataDir, profileId } = setup();
    const rec = createRecording(r, dataDir, { profileId, fileName: "call.mp4", size: 4 }, roomy);
    expect(() => appendRecordingChunk(r, dataDir, rec.id, 0, bytes(5), now)).toThrow(/tamanho/);
    const big = createRecording(
      r,
      dataDir,
      { profileId, fileName: "big.mp4", size: 20 * 1024 ** 2 },
      roomy,
    );
    expect(() => appendRecordingChunk(r, dataDir, big.id, 0, bytes(9 * 1024 ** 2), now)).toThrow(
      RecordingError,
    );
    appendRecordingChunk(r, dataDir, rec.id, 0, bytes(4), now);
    try {
      appendRecordingChunk(r, dataDir, rec.id, 4, bytes(1), now);
      throw new Error("devia falhar");
    } catch (e) {
      expect((e as RecordingError).code).toBe("not_uploading");
    }
  });
});

describe("F13/M1.4 · apagar", () => {
  it("só o vídeo: a entrevista fica, sem reprodução; o trabalho e os quadros ficam", () => {
    const { r, dataDir, profileId } = setup();
    const rec = createRecording(r, dataDir, { profileId, fileName: "call.mp4", size: 2 }, roomy);
    appendRecordingChunk(r, dataDir, rec.id, 0, bytes(2), now);
    mkdirSync(join(recordingDir(dataDir, rec.id), "work"), { recursive: true });
    writeFileSync(join(recordingDir(dataDir, rec.id), "work", "probe.json"), "{}");
    const after = removeRecordingVideo(r, dataDir, rec.id);
    expect(after.hasVideo).toBe(false);
    expect(recordingVideoPath(dataDir, after)).toBeNull();
    expect(existsSync(join(dataDir, "interviews", rec.id, "video.mp4"))).toBe(false);
    expect(existsSync(join(recordingDir(dataDir, rec.id), "work", "probe.json"))).toBe(true);
  });

  it("tudo: banco, vídeo e quadros", () => {
    const { r, dataDir, profileId } = setup();
    const rec = createRecording(r, dataDir, { profileId, fileName: "call.mp4", size: 2 }, roomy);
    appendRecordingChunk(r, dataDir, rec.id, 0, bytes(2), now);
    mkdirSync(recordingFramesDir(dataDir, rec.id), { recursive: true });
    removeRecording(r, dataDir, rec.id);
    expect(r.recordings.get(rec.id)).toBeNull();
    expect(existsSync(recordingDir(dataDir, rec.id))).toBe(false);
    expect(existsSync(recordingFramesDir(dataDir, rec.id))).toBe(false);
  });

  it("apagar a candidatura apaga as entrevistas dela, com as pastas", () => {
    const { r, dataDir, app } = setup();
    const rec = createRecording(
      r,
      dataDir,
      { jobApplicationId: app.id, fileName: "a.mp4", size: 1 },
      roomy,
    );
    appendRecordingChunk(r, dataDir, rec.id, 0, bytes(1), now);
    removeJobApplication(r, dataDir, app.id);
    expect(r.recordings.get(rec.id)).toBeNull();
    expect(existsSync(recordingDir(dataDir, rec.id))).toBe(false);
  });
});
