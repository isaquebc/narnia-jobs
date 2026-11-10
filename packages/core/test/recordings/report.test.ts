import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InterviewReportDraft } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  appendRecordingChunk,
  buildInterviewBrief,
  checkInterviewReport,
  createRecording,
  formatTranscript,
  importMediaResults,
  recordingDir,
} from "../../src/recordings";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F13/M5 · entrada e checagem do relatório: transcrição numerada por turno, resumo para o modelo, e a checagem por
 * código (§2.5): citação literal na pessoa certa (corrigida pelo texto real ou removida), segundo exato pelas palavras,
 * tempos que existem, uma leitura por anotação e o alerta do sorriso montado pelo código (F13-4).
 */
const FIXTURE = join(__dirname, "..", "fixtures", "recording-work");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-rep-"));
  dirs.push(dataDir);
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  r.users.upsert({ fullName: "Alex Souza" });
  const rec = createRecording(
    r,
    dataDir,
    { profileId, fileName: "call.webm", size: 2 },
    { freeBytes: 1e12 },
  );
  appendRecordingChunk(r, dataDir, rec.id, 0, new Uint8Array([1, 2]));
  cpSync(FIXTURE, join(recordingDir(dataDir, rec.id), "work"), { recursive: true });
  const a = importMediaResults(r, dataDir, rec.id);
  return { r, dataDir, rec, a };
}

const empty = (): InterviewReportDraft => ({
  verdict: { level: "mixed", summary: "ok", points: [] },
  shouldNotHaveSaid: [],
  answers: [],
  worked: [],
  discourse: { summary: "", points: [] },
  smile: { observations: [] },
  reactions: [],
  notes: [],
  setup: { people: [], tips: [] },
  people: [],
  drills: [],
  limitations: [],
  scores: {
    completeness: { points: 8, reason: "Respondeu quase tudo.", turns: [] },
    objectivity: { points: 6, reason: "Algumas voltas.", turns: [] },
    clarity: { points: 7, reason: "Clara.", turns: [] },
  },
});

describe("F13 · nota da entrevista", () => {
  it("pesos 40/20/20/20; setup pela média; rosto não reconhecido zera a câmera e conta na média (decisão do dono)", () => {
    const { a } = setup();
    const { content } = checkInterviewReport(empty(), a);
    const s = content.score;
    if (!s) throw new Error("sem nota");
    expect(s.criteria.map((c) => [c.key, c.weight, c.points])).toEqual([
      ["completeness", 40, 8],
      ["objectivity", 20, 6],
      ["clarity", 20, 7],
      ["setup", 20, 3.3],
    ]);
    expect(s.setup.map((x) => [x.key, x.points])).toEqual([
      ["camera", 0],
      ["audio", 10],
      ["noise", 0],
    ]);
    expect(s.setup[0]?.reason).toMatch(/não foi reconhecido/);
    expect(s.overall).toBe(65);
  });

  it("sem a voz da pessoa candidata medida, áudio e ruído também ficam com 0", () => {
    const { a } = setup();
    const noLevels = {
      ...a,
      persons: a.persons.map((p) =>
        p.isCandidate ? { ...p, measurements: { ...p.measurements, levels: null } } : p,
      ),
    };
    const s = checkInterviewReport(empty(), noLevels).content.score;
    expect(s?.setup.map((x) => [x.key, x.points])).toEqual([
      ["camera", 0],
      ["audio", 0],
      ["noise", 0],
    ]);
    expect(s?.criteria.find((c) => c.key === "setup")?.points).toBe(0);
  });

  it("turnos que não existem saem da justificativa; sem falas da pessoa candidata, o conteúdo não é avaliado", () => {
    const { a } = setup();
    const draft = empty();
    draft.scores.clarity.turns = [1, 9999];
    const { content, warnings } = checkInterviewReport(draft, a);
    expect(content.score?.criteria.find((c) => c.key === "clarity")?.turns).toEqual([1]);
    expect(warnings.some((w) => w.includes("9999"))).toBe(true);

    const cand = a.persons.find((p) => p.isCandidate);
    const noCand = { ...a, turns: a.turns.filter((t) => t.personId !== cand?.id) };
    const s = checkInterviewReport(empty(), noCand).content.score;
    expect(s?.criteria.filter((c) => c.key !== "setup").map((c) => c.points)).toEqual([
      null,
      null,
      null,
    ]);
    // nota só do setup enganaria: sem conteúdo avaliado, não há nota geral
    expect(s?.overall).toBeNull();
  });
});

describe("F13/M5 · transcrição e resumo", () => {
  it("um turno por linha, com número, tempo, pessoa e papel", () => {
    const { a } = setup();
    const lines = formatTranscript(a).split("\n");
    expect(lines).toHaveLength(a.turns.length);
    expect(lines[0]).toMatch(
      /^\[0\] \d\d:\d\d–\d\d:\d\d P1 \(Marina Duarte, entrevista\): Oi Alex/,
    );
    expect(lines[1]).toMatch(/^\[1\] .* P2 \(Alex Souza, candidato\): /);
  });

  it("resumo com pessoas, medições, eventos com tempo e leitura dos quadros", () => {
    const { r, rec, a } = setup();
    const brief = buildInterviewBrief(r, rec.id, [
      {
        file: a.frames[0]?.file ?? "",
        observed: "Cabeça baixa.",
        hypothesis: "Pode estar anotando.",
      },
    ]);
    expect(brief.persons).toEqual([
      expect.objectContaining({ key: "P1", name: "Marina Duarte", role: "entrevista" }),
      expect.objectContaining({ key: "P2", name: "Alex Souza", role: "candidato" }),
    ]);
    expect(
      (brief.persons as Array<{ face: { reliability: { level: string } } }>)[1]?.face.reliability
        .level,
    ).toBe("poor");
    expect(brief.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "note", level: "confirmed", person: "P1" }),
      ]),
    );
    expect(brief.frames).toEqual([expect.objectContaining({ observed: "Cabeça baixa." })]);
  });

  it("leva os dados de carreira da pessoa: experiências com conquistas, projetos, formação, skills e idiomas", () => {
    const { r, rec } = setup();
    const brief = buildInterviewBrief(r, rec.id) as unknown as {
      candidate: {
        experiences: Array<Record<string, unknown>>;
        skills: string[];
        projects: unknown[];
        education: unknown[];
        languages: unknown[];
        card: string | null;
      };
    };
    const acme = brief.candidate.experiences.find((e) => e.company === "Acme Pagamentos");
    expect(acme).toEqual(
      expect.objectContaining({
        title: "Engenheira de Software Sênior",
        period: "2023-02 – atual",
        achievements: expect.arrayContaining([
          "Reduziu a latência p95 do checkout (de 800 ms para 300 ms)",
        ]),
      }),
    );
    expect(acme).not.toHaveProperty("compensation");
    expect(brief.candidate.skills).toContain("TypeScript");
    expect(brief.candidate.projects.length).toBeGreaterThan(0);
    expect(brief.candidate.education.length).toBeGreaterThan(0);
    expect(brief.candidate.languages.length).toBeGreaterThan(0);
    expect(brief.candidate.card).toMatch(/\S/);
  });
});

describe("F13/M5 · checagem por código", () => {
  it("citação literal fica, com o segundo da primeira palavra; com erro pequeno vira o texto real; inventada sai", () => {
    const { a, r, rec } = setup();
    const wrong = a.turns.find((t) => t.text.includes("B-tree é melhor"));
    if (!wrong) throw new Error("turno da resposta errada");
    const draft = empty();
    draft.shouldNotHaveSaid = [
      {
        turn: wrong.idx,
        quote: "o B-tree é melhor para busca de texto livre",
        observed: "",
        interpretation: "",
        better: "",
      },
      {
        turn: wrong.idx,
        quote: "o B tree é o melhor para buscar texto livre",
        observed: "",
        interpretation: "",
        better: "",
      },
      {
        turn: wrong.idx,
        quote: "eu nunca usei banco de dados na vida",
        observed: "",
        interpretation: "",
        better: "",
      },
    ];
    const { content, warnings } = checkInterviewReport(
      draft,
      a,
      r.recordingAnalysis.turnWords(rec.id),
    );
    expect(content.shouldNotHaveSaid).toHaveLength(2);
    const [ok, fixed] = content.shouldNotHaveSaid;
    expect(ok?.t).toBeGreaterThan(wrong.start);
    expect(ok?.t).toBeLessThan(wrong.end);
    expect(fixed?.quote).toContain("B-tree é melhor para busca de texto livre");
    expect(warnings.some((w) => /corrigida/.test(w))).toBe(true);
    expect(warnings.some((w) => /removida/.test(w))).toBe(true);
  });

  it("citação de outra pessoa é movida para o turno certo do candidato ou sai", () => {
    const { a } = setup();
    const candidateTurn = a.turns.find((t) => t.text.includes("monólito ganhou"));
    const draft = empty();
    draft.worked = [{ turn: 0, quote: "O monólito ganhou e o time concordou.", why: "x" }];
    const { content } = checkInterviewReport(draft, a);
    expect(content.worked[0]?.turn).toBe(candidateTurn?.idx);
  });

  it("perguntas e respostas nos turnos certos; tempos inexistentes saem do texto", () => {
    const { a } = setup();
    const draft = empty();
    const dur = a.recording.durationS ?? 0;
    draft.verdict.points = [
      `Resposta longa em [00:20], depois silêncio em [${Math.floor(dur / 60) + 5}:00].`,
    ];
    draft.answers = [
      {
        questionTurn: 2,
        question: "Índices",
        answerTurns: [3, 0],
        problem: "wrong",
        missing: "Inverteu os índices.",
        suggestion: "[completar]",
        certainty: "high",
      },
      {
        questionTurn: 999,
        question: "x",
        answerTurns: [1],
        problem: "unclear",
        missing: "",
        suggestion: "",
        certainty: "low",
      },
    ];
    const { content, warnings } = checkInterviewReport(draft, a);
    expect(content.answers).toHaveLength(1);
    expect(content.answers[0]?.answerTurns).toEqual([3]);
    expect(content.answers[0]?.t).toBe(a.turns[2]?.start);
    expect(content.verdict.points[0]).toContain("[00:20]");
    expect(content.verdict.points[0]).not.toMatch(/\[\d+:00\]\./);
    expect(warnings.some((w) => /tempo/.test(w))).toBe(true);
  });

  it("toda anotação tem leitura (indeterminada se o modelo pulou); evento inexistente sai; alerta do sorriso", () => {
    const { a } = setup();
    const notes = a.events.filter((e) => e.type === "note");
    const draft = empty();
    draft.notes = [
      {
        event: notes[0]?.key ?? "",
        reading: "unfavorable",
        reason: "Anotou logo depois da resposta errada.",
      },
      { event: "e99", reading: "favorable", reason: "?" },
    ];
    draft.people = [{ person: "P1 (Marina Duarte)", role: "x", summary: "y", signals: [] }];
    const { content } = checkInterviewReport(draft, a);
    expect(content.people.map((p) => p.person)).toEqual(["P1"]);
    expect(content.notes.map((n) => n.event).sort()).toEqual(notes.map((n) => n.key).sort());
    expect(content.notes.find((n) => n.event === notes[1]?.key)?.reading).toBe("indeterminate");
    expect(content.smile.reliability?.level).toBe("poor");
    expect(content.smile.alert).toMatch(/% do tempo/);
  });
});
