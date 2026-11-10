import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  RecordingAnalysis,
  RecordingFrame,
  RecordingPerson,
  RecordingPersonPatch,
  RecordingTurn,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { PersonInsert } from "../db/repos/recording-analysis";
import { RecordingError, recordingDir, recordingFramesDir } from "./index";

/**
 * F13/M4 · resultado do media → banco (plans/plan-v0/tasks/F13 §2.2, §3). Lê `interviews/<id>/work/*.json`, troca a
 * análise inteira (pessoas, turnos, eventos), copia os quadros escolhidos para `interview-frames/<id>/` (no backup) e
 * marca quem é o candidato: pelo nome na etiqueta igual ao da pessoa usuária; sem isso, quem mais fala (a pessoa
 * confirma na tela).
 */
// biome-ignore lint/suspicious/noExplicitAny: JSON do serviço Python, lido campo a campo
type Json = Record<string, any>;

function readWork(dataDir: string, id: string): (name: string) => Json | null {
  const work = join(recordingDir(dataDir, id), "work");
  return (name) => {
    const p = join(work, `${name}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Json) : null;
  };
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);

/** Mesmo primeiro nome e, se a etiqueta tiver mais de um, mais um nome em comum. */
export function sameName(user: string, label: string): boolean {
  const a = fold(user);
  const b = fold(label);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  return b.length === 1 || a.slice(1).some((x) => b.slice(1).includes(x));
}

export function importMediaResults(
  repos: Repos,
  dataDir: string,
  id: string,
  opts: { now?: Date } = {},
): RecordingAnalysis {
  const rec = repos.recordings.get(id);
  if (!rec) throw new RecordingError("not_found", "Entrevista não encontrada.");
  const read = readWork(dataDir, id);
  const probe = read("probe");
  const audio = read("audio");
  const transcribe = read("transcribe");
  const turnsOut = read("turns");
  if (!probe || !transcribe || !turnsOut)
    throw new RecordingError(
      "invalid",
      "A análise do vídeo não terminou: faltam etapas do serviço media.",
    );
  const link = read("link");
  const layout = read("layout");
  const voice = read("voice") ?? { speakers: {}, talk_share: {} };
  const levels = read("levels") ?? { speakers: {} };
  const events = read("events");
  const framesOut = read("frames");
  const rawTurns = turnsOut.turns as Json[];

  // pessoas: pela ligação voz–rosto (com imagem) ou pelos falantes (só áudio)
  const speakerKey = new Map<string, string>();
  let personRows: Array<{
    key: string;
    name: string | null;
    speaker: string | null;
    track: string | null;
    ambiguous: boolean;
    voiceKey: string;
  }> = [];
  if (link) {
    personRows = (link.persons as Json[]).map((p) => ({
      key: String(p.id),
      name: p.name ?? null,
      speaker: p.speaker ?? null,
      track: p.track ?? null,
      ambiguous: Boolean(p.ambiguous),
      voiceKey: String(p.id),
    }));
  } else {
    for (const t of rawTurns) {
      const spk = t.speaker === null ? "?" : String(t.speaker);
      if (!speakerKey.has(spk)) speakerKey.set(spk, `P${speakerKey.size + 1}`);
    }
    personRows = [...speakerKey].map(([spk, key]) => ({
      key,
      name: null,
      speaker: spk === "?" ? null : spk,
      track: null,
      ambiguous: spk === "?",
      voiceKey: spk,
    }));
  }
  const talk = (k: string) => Number(voice.talk_share?.[k] ?? 0);
  const userName = repos.users.get()?.fullName ?? "";
  const byName = personRows.filter((p) => p.name && userName && sameName(userName, p.name));
  const candidateKey =
    byName.length === 1
      ? byName[0]?.key
      : [...personRows].sort((a, b) => talk(b.voiceKey) - talk(a.voiceKey))[0]?.key;
  const persons: PersonInsert[] = personRows.map((p) => ({
    key: p.key,
    name: p.name,
    nameSource: p.name ? "ocr" : null,
    isCandidate: p.key === candidateKey,
    candidateSource: p.key === candidateKey ? (byName.length === 1 ? "name" : "talk") : null,
    contactId: null,
    speaker: p.speaker,
    track: p.track,
    ambiguous: p.ambiguous,
    measurements: {
      talkShare: talk(p.voiceKey),
      voice: voice.speakers?.[p.voiceKey] ?? null,
      levels: levels.speakers?.[p.voiceKey] ?? null,
      face: events?.persons?.[p.key] ?? null,
    },
    card: null,
  }));

  const turnPersons: Array<string | null> = link
    ? (link.turn_persons as Array<string | null>)
    : rawTurns.map((t) => speakerKey.get(t.speaker === null ? "?" : String(t.speaker)) ?? null);
  const frames = ((framesOut?.frames ?? []) as Json[]).map((f) => ({
    t: Number(f.t),
    file: String(f.file),
    reason: f.reason === "reference" ? ("reference" as const) : ("event" as const),
    personKey: (f.person as string | null) ?? null,
    events: (f.events as string[]) ?? [],
  }));
  const frameOf = new Map<string, string>();
  for (const f of frames) for (const e of f.events) if (!frameOf.has(e)) frameOf.set(e, f.file);

  repos.recordingAnalysis.replace(id, {
    persons,
    turns: rawTurns.map((t, idx) => ({
      idx,
      personKey: turnPersons[idx] ?? null,
      start: Number(t.start),
      end: Number(t.end),
      text: String(t.text),
      words: t.words,
      corrected: false,
    })),
    events: ((events?.events ?? []) as Json[]).map((e) => ({
      key: String(e.id),
      personKey: (e.person as string | null) ?? null,
      t: Number(e.t),
      durationS: e.duration_s ?? null,
      type: e.type,
      level: e.level ?? null,
      reading: e.type === "note" ? "indeterminate" : null,
      reason: null,
      turnIdx: e.turn ?? e.after_turn ?? null,
      frame: frameOf.get(String(e.id)) ?? null,
      data: { cue: e.cue ?? null, intensity: e.intensity ?? null, evidence: e.evidence ?? null },
    })),
  });

  // quadros: só os escolhidos, na pasta do backup
  const framesDir = recordingFramesDir(dataDir, id);
  rmSync(framesDir, { recursive: true, force: true });
  const src = join(recordingDir(dataDir, id), "work", "frames");
  const kept = frames.filter((f) => existsSync(join(src, f.file)));
  if (kept.length) {
    mkdirSync(framesDir, { recursive: true });
    for (const f of kept) cpSync(join(src, f.file), join(framesDir, f.file));
  }
  const idByKey = new Map(repos.recordingAnalysis.persons(id).map((p) => [p.key, p.id]));
  const words = rawTurns.flatMap((t) => (t.words as Json[]) ?? []);
  repos.recordings.update(
    id,
    {
      durationS: Number(probe.duration) || null,
      language: transcribe.language ?? null,
      meetingStartS: layout?.meeting_start_s ?? (rawTurns[0] ? Number(rawTurns[0].start) : null),
      approximate: Boolean(link?.approximate) || turnsOut.method === "none",
      models: {
        transcribe: transcribe.model ?? null,
        device: transcribe.device ?? null,
        diarize: turnsOut.method === "none" ? null : "pyannote/speaker-diarization-community-1",
        faces: link ? "mediapipe face_landmarker" : null,
      },
      measurements: {
        integratedLufs: audio?.integrated_lufs ?? levels.integrated_lufs ?? null,
        noiseFloorDbfs: levels.noise_floor_dbfs ?? null,
        languageProbability: transcribe.language_probability ?? null,
        words: words.length,
        lowConfidenceWords: words.filter((w) => Number(w.p ?? 1) < 0.5).length,
        hasVideo: Boolean(probe.video),
      },
      frames: kept.map((f) => ({
        t: f.t,
        file: f.file,
        reason: f.reason,
        personId: f.personKey ? (idByKey.get(f.personKey) ?? null) : null,
        events: f.events,
      })),
      factsVersion: repos.settings.getFactsVersion(),
      analyzedAt: (opts.now ?? new Date()).toISOString(),
    },
    opts.now,
  );
  return recordingAnalysis(repos, id);
}

/** Visão completa para a página da entrevista, a API e o recrutador. */
export function recordingAnalysis(repos: Repos, id: string): RecordingAnalysis {
  const recording = repos.recordings.get(id);
  if (!recording) throw new RecordingError("not_found", "Entrevista não encontrada.");
  const extras = repos.recordings.extras(id);
  return {
    recording,
    persons: repos.recordingAnalysis.persons(id),
    turns: repos.recordingAnalysis.turns(id),
    events: repos.recordingAnalysis.events(id),
    frames: (extras?.frames ?? []) as RecordingFrame[],
    measurements: extras?.measurements ?? null,
    report: repos.recordingAnalysis.latestReport(id),
  };
}

/** A pessoa corrige quem falou um turno (F13-5: sem token a separação é aproximada). */
export function correctTurnPerson(
  repos: Repos,
  recordingId: string,
  turnId: string,
  personId: string,
): RecordingTurn {
  const turn = repos.recordingAnalysis.turn(turnId);
  if (!turn || turn.recordingId !== recordingId)
    throw new RecordingError("not_found", "Turno não encontrado.");
  const person = repos.recordingAnalysis.person(personId);
  if (!person || person.recordingId !== recordingId)
    throw new RecordingError("invalid", "Essa pessoa não está nesta entrevista.");
  return repos.recordingAnalysis.setTurnPerson(turnId, personId);
}

/** Renomear, marcar quem é o candidato (só um) e ligar a um contato da vaga. */
export function patchRecordingPerson(
  repos: Repos,
  recordingId: string,
  personId: string,
  patch: RecordingPersonPatch,
): RecordingPerson {
  const person = repos.recordingAnalysis.person(personId);
  if (!person || person.recordingId !== recordingId)
    throw new RecordingError("not_found", "Pessoa não encontrada nesta entrevista.");
  if (patch.isCandidate)
    for (const other of repos.recordingAnalysis.persons(recordingId))
      if (other.id !== personId && other.isCandidate)
        repos.recordingAnalysis.updatePerson(other.id, {
          isCandidate: false,
          candidateSource: null,
        });
  return repos.recordingAnalysis.updatePerson(personId, {
    ...(patch.name !== undefined ? { name: patch.name, nameSource: "user" as const } : {}),
    ...(patch.isCandidate !== undefined
      ? { isCandidate: patch.isCandidate, candidateSource: "user" as const }
      : {}),
    ...(patch.contactId !== undefined ? { contactId: patch.contactId } : {}),
  });
}

/** Quadros escolhidos (para servir e para o recrutador ler). */
export function recordingFramePath(dataDir: string, id: string, file: string): string | null {
  if (!/^f\d{2}-\d{6}\.jpg$/.test(file)) return null;
  const p = join(recordingFramesDir(dataDir, id), file);
  return existsSync(p) ? p : null;
}

export const listFrameFiles = (dataDir: string, id: string) =>
  existsSync(recordingFramesDir(dataDir, id)) ? readdirSync(recordingFramesDir(dataDir, id)) : [];
