import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  appendRecordingChunk,
  createRecording,
  importMediaResults,
  recordingAnalysis,
  recordingDir,
  recordingFramesDir,
  removeRecording,
} from "../../src/recordings";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F13/M4 · importar os resultados do media (fixture gerada pelo modo falso: entrevista sintética de 60 s com duas
 * pessoas) → pessoas, turnos, eventos, quadros no backup; quem é o candidato; correções e visão completa.
 */
const FIXTURE = join(__dirname, "..", "fixtures", "recording-work");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const now = new Date("2026-11-10T12:00:00.000Z");

function setup(userName = "Alex Souza") {
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-ana-"));
  dirs.push(dataDir);
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  r.users.upsert({ fullName: userName });
  const rec = createRecording(
    r,
    dataDir,
    { profileId, fileName: "call.webm", size: 2 },
    { freeBytes: 1e12, now },
  );
  appendRecordingChunk(r, dataDir, rec.id, 0, new Uint8Array([1, 2]), now);
  cpSync(FIXTURE, join(recordingDir(dataDir, rec.id), "work"), { recursive: true });
  return { r, dataDir, rec };
}

describe("F13/M4 · importar a análise do media", () => {
  it("pessoas com nome, voz e rosto; turnos; eventos; quadros copiados para a pasta do backup", () => {
    const { r, dataDir, rec } = setup();
    importMediaResults(r, dataDir, rec.id, { now });
    const a = recordingAnalysis(r, rec.id);
    expect(a.recording).toMatchObject({ language: "pt", approximate: false });
    expect(a.recording.durationS).toBeGreaterThan(59);
    expect(a.recording.meetingStartS).toBeGreaterThan(0);
    expect(a.persons.map((p) => p.name)).toEqual(["Marina Duarte", "Alex Souza"]);
    const [marina, alex] = a.persons;
    expect(alex).toMatchObject({ isCandidate: true, candidateSource: "name" });
    expect(marina?.isCandidate).toBe(false);
    expect(alex?.measurements).toHaveProperty("voice.wpm");
    expect(alex?.measurements).toHaveProperty("face.reliability.level", "poor");
    expect(a.turns.length).toBeGreaterThan(10);
    expect(a.turns[0]?.personId).toBe(marina?.id);
    const notes = a.events.filter((e) => e.type === "note");
    expect(notes.map((e) => e.level).sort()).toEqual(["confirmed", "probable"]);
    expect(notes.every((e) => e.personId === marina?.id && e.reading === "indeterminate")).toBe(
      true,
    );
    expect(a.frames.length).toBeGreaterThan(0);
    for (const f of a.frames)
      expect(existsSync(join(recordingFramesDir(dataDir, rec.id), f.file))).toBe(true);
    expect(a.measurements).toHaveProperty("integratedLufs");
  });

  it("sem o nome da pessoa na tela: candidato é quem mais fala, marcado para confirmar", () => {
    const { r, dataDir, rec } = setup("Fulana de Tal");
    importMediaResults(r, dataDir, rec.id, { now });
    const persons = recordingAnalysis(r, rec.id).persons;
    const candidate = persons.filter((p) => p.isCandidate);
    expect(candidate).toHaveLength(1);
    expect(candidate[0]?.candidateSource).toBe("talk");
  });

  it("correções: trocar quem falou, marcar o candidato e renomear", async () => {
    const { r, dataDir, rec } = setup();
    importMediaResults(r, dataDir, rec.id, { now });
    const { correctTurnPerson, patchRecordingPerson } = await import("../../src/recordings");
    const a = recordingAnalysis(r, rec.id);
    const [marina, alex] = a.persons;
    const t0 = a.turns[0];
    if (!marina || !alex || !t0) throw new Error("análise vazia");
    const turn = correctTurnPerson(r, rec.id, t0.id, alex.id);
    expect(turn).toMatchObject({ personId: alex.id, corrected: true });
    patchRecordingPerson(r, rec.id, marina.id, { isCandidate: true, name: "Marina D." });
    const after = recordingAnalysis(r, rec.id).persons;
    expect(after.find((p) => p.id === marina.id)).toMatchObject({
      isCandidate: true,
      candidateSource: "user",
      name: "Marina D.",
      nameSource: "user",
    });
    expect(after.find((p) => p.id === alex.id)?.isCandidate).toBe(false);
    expect(() => correctTurnPerson(r, rec.id, t0.id, "outra")).toThrow();
  });

  it("apagar a entrevista leva os quadros do backup junto", () => {
    const { r, dataDir, rec } = setup();
    importMediaResults(r, dataDir, rec.id, { now });
    removeRecording(r, dataDir, rec.id);
    expect(existsSync(recordingFramesDir(dataDir, rec.id))).toBe(false);
    expect(r.recordingAnalysis.persons(rec.id)).toEqual([]);
  });
});
