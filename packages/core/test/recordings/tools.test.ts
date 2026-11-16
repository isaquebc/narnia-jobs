import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { DEFAULT_STAGES } from "../../src/job-applications";
import {
  appendRecordingChunk,
  createRecording,
  createRecordingTools,
  importMediaResults,
  RecordingError,
  recordingDir,
  recordingUrl,
} from "../../src/recordings";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F13/M5 · tools `recording.*` do recrutador: lista por perfil ou candidatura (com etapa, data, duração e estado),
 * detalhe com pessoas, eventos, relatório e limitações, e a transcrição numerada em janelas de até 80 turnos.
 */
const FIXTURE = join(__dirname, "..", "fixtures", "recording-work");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-rec-tools-"));
  dirs.push(dataDir);
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const p = r.postings.create({ company: "Acme", title: "Dev Backend" } as never, {
    source: "user",
  });
  const app = r.jobApplications.create({
    postingId: p.id,
    profileId,
    cvVersionId: null,
    coverLetterVersionId: null,
    appliedOn: "2026-11-01",
    stages: [...DEFAULT_STAGES],
  });
  const stageId = app.stages[1]?.id as string;
  const rec = createRecording(
    r,
    dataDir,
    {
      profileId,
      jobApplicationId: app.id,
      stageId,
      fileName: "call.webm",
      size: 2,
      title: "Técnica",
    },
    { freeBytes: 1e12 },
  );
  appendRecordingChunk(r, dataDir, rec.id, 0, new Uint8Array([1, 2]));
  cpSync(FIXTURE, join(recordingDir(dataDir, rec.id), "work"), { recursive: true });
  importMediaResults(r, dataDir, rec.id);
  const loose = createRecording(
    r,
    dataDir,
    { profileId, fileName: "solta.mp4", size: 2 },
    {
      freeBytes: 1e12,
    },
  );
  return { r, rec, loose, app, profileId, tools: createRecordingTools(r) };
}

describe("F13/M5 · tools recording.*", () => {
  it("lista da candidatura (título, etapa, estado) e do perfil ativo; sem perfil, vazia", async () => {
    const { r, rec, loose, app, tools } = setup();
    const byApp = await tools["recording.list"]({ jobApplicationId: app.id });
    expect(byApp.items).toHaveLength(1);
    expect(byApp.items[0]).toMatchObject({ id: rec.id, url: `/entrevistas/${rec.id}` });
    expect(byApp.items[0]?.line).toMatch(/^Técnica · etapa /);
    const byProfile = await tools["recording.list"]({});
    expect(byProfile.items.map((i) => i.id).sort()).toEqual([rec.id, loose.id].sort());
    expect(byProfile.items.find((i) => i.id === loose.id)?.line).toMatch(
      /^solta\.mp4 · .* · enviando$/,
    );
    r.db.exec("delete from profile");
    expect((await tools["recording.list"]({})).items).toEqual([]);
  });

  it("detalhe: pessoas com fala e rosto, eventos, limitações da separação aproximada e do relatório", async () => {
    const { r, rec, tools } = setup();
    const got = await tools["recording.get"]({ id: rec.id });
    expect(got.persons.length).toBeGreaterThan(0);
    expect(got.persons.some((p) => /candidato\(a\)/.test(p.line))).toBe(true);
    expect(got.persons.every((p) => /rosto/.test(p.line))).toBe(true);
    expect(got.report).toBeNull();
    r.recordings.update(rec.id, { approximate: true });
    r.recordingAnalysis.addReport(rec.id, {
      content: { limitations: ["Áudio baixo no começo."] } as never,
      warnings: [],
      model: null,
      usageEventId: null,
    });
    const again = await tools["recording.get"]({ id: rec.id });
    expect(again.limitations).toEqual([
      "Vozes separadas por aproximação (sem token do Hugging Face).",
      "Áudio baixo no começo.",
    ]);
    expect(again.report).not.toBeNull();
    await expect(tools["recording.get"]({ id: "nao-existe" })).rejects.toBeInstanceOf(
      RecordingError,
    );
  });

  it("transcrição numerada com link para o segundo; janela por turno", async () => {
    const { rec, tools } = setup();
    const all = await tools["recording.transcript"]({ id: rec.id });
    expect(all.total).toBeGreaterThan(1);
    expect(all.lines[0]?.turn).toBe(0);
    expect(all.lines[0]?.url).toMatch(new RegExp(`^/entrevistas/${rec.id}\\?t=\\d+$`));
    const one = await tools["recording.transcript"]({ id: rec.id, fromTurn: 1, toTurn: 1 });
    expect(one.lines.map((l) => l.turn)).toEqual([1]);
    expect(recordingUrl("x")).toBe("/entrevistas/x");
    expect(recordingUrl("x", 12.7)).toBe("/entrevistas/x?t=12");
  });
});
