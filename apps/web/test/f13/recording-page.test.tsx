import type { RecordingAnalysis } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F13/M6 · página da entrevista gravada: vídeo, quem é quem (com correção), relatório na ordem aprovada (F13-14), tempos
 * que levam ao trecho, transcrição com correção de quem falou, quadros, refazer o relatório e conversar; andamento.
 */
const base = (
  over: Partial<RecordingAnalysis["recording"]> = {},
): RecordingAnalysis["recording"] => ({
  id: "r1",
  profileId: "p1",
  jobApplicationId: null,
  stageId: null,
  title: "Entrevista técnica",
  state: "ready",
  fileName: "tecnica.webm",
  mime: "video/webm",
  size: 2048,
  received: 2048,
  hasVideo: true,
  durationS: 480,
  error: null,
  step: null,
  progress: 100,
  language: "pt",
  meetingStartS: 38,
  approximate: false,
  analyzedAt: "2026-11-10T12:00:00.000Z",
  createdAt: "2026-11-10T11:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  ...over,
});

const analysis = (over: Partial<RecordingAnalysis["recording"]> = {}): RecordingAnalysis => ({
  recording: base(over),
  persons: [
    {
      id: "m",
      key: "P1",
      name: "Marina Duarte",
      nameSource: "ocr",
      isCandidate: false,
      candidateSource: null,
      contactId: null,
      speaker: "S0",
      track: "T1",
      ambiguous: false,
      measurements: {
        talkShare: 0.32,
        face: { reliability: { detected_pct: 98.9, face_px: 393, level: "good" } },
      },
      card: {
        role: "Líder técnica",
        summary: "Conduz com perguntas objetivas.",
        signals: ["valoriza exemplos"],
      },
    },
    {
      id: "a",
      key: "P2",
      name: "Alex Souza",
      nameSource: "ocr",
      isCandidate: true,
      candidateSource: "talk",
      contactId: null,
      speaker: "S1",
      track: null,
      ambiguous: true,
      measurements: { talkShare: 0.68, voice: { wpm: 171, fillers_per_min: 1.5 }, face: null },
      card: null,
    },
  ],
  turns: [
    {
      id: "t0",
      idx: 0,
      personId: "m",
      start: 82,
      end: 95,
      text: "Quando usar B-tree e GIN?",
      corrected: false,
    },
    {
      id: "t1",
      idx: 1,
      personId: "a",
      start: 97,
      end: 125,
      text: "O B-tree é melhor para texto livre.",
      corrected: false,
    },
  ],
  events: [
    {
      id: "ev1",
      key: "e1",
      personId: "m",
      t: 126,
      durationS: 6,
      type: "note",
      level: "probable",
      reading: "unfavorable",
      reason: "Anotou logo depois da resposta errada.",
      turnIdx: 1,
      frame: "f01-001260.jpg",
      data: {},
    },
  ],
  frames: [{ t: 126, file: "f01-001260.jpg", reason: "event", personId: "m", events: ["e1"] }],
  measurements: { integratedLufs: -21 },
  report: {
    id: "rep1",
    version: 1,
    model: "sonnet",
    createdAt: "2026-11-10T12:00:00.000Z",
    warnings: ["o que não deveria: citação corrigida pelo texto real do turno 1"],
    content: {
      verdict: {
        level: "mixed",
        summary: "Cordial, com um erro técnico.",
        points: ["Errou os índices em [01:37]."],
      },
      shouldNotHaveSaid: [
        {
          turn: 1,
          quote: "O B-tree é melhor para texto livre.",
          t: 97,
          observed: "Inverteu.",
          interpretation: "Pesa.",
          better: "B-tree para igualdade.",
        },
      ],
      answers: [
        {
          questionTurn: 0,
          question: "Índices",
          answerTurns: [1],
          t: 82,
          problem: "wrong",
          missing: "GIN é para texto.",
          suggestion: "[completar: um índice seu]",
          certainty: "high",
        },
      ],
      worked: [],
      discourse: { summary: "Ritmo bom.", points: ["171 palavras por minuto."] },
      smile: {
        observations: ["Sem leitura do sorriso."],
        alert: "Alerta de confiabilidade: o rosto de Alex Souza não foi detectado (0% do tempo).",
        reliability: { detectedPct: 0, facePx: 0, level: "poor" },
      },
      reactions: [],
      notes: [
        {
          event: "e1",
          t: 126,
          reading: "unfavorable",
          reason: "Anotou logo depois da resposta errada.",
        },
      ],
      setup: {
        people: [{ person: "P2", camera: "Miniatura.", lighting: "Ok.", audio: "Bom." }],
        tips: ["Fixe a sua câmera."],
      },
      people: [{ person: "P1", role: "Líder técnica", summary: "Objetiva.", signals: [] }],
      drills: [
        { title: "Índices", how: "60 segundos." },
        { title: "Exemplo", how: "Um caso real." },
        { title: "Apoio", how: "Menos 'né'." },
      ],
      limitations: ["Rosto em miniatura."],
    },
  },
});

function api(a = analysis()) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    getRecordingAnalysis: vi.fn(async () => a),
    recordingVideoUrl: (id: string) => `/api/recordings/${id}/video`,
    recordingFrameUrl: (id: string, f: string) => `/api/recordings/${id}/frames/${f}`,
    patchRecordingTurn: vi.fn(async () => a.turns[0]),
    patchRecordingPerson: vi.fn(async () => a.persons[0]),
    regenerateRecordingReport: vi.fn(async () => a.recording),
    analyzeRecording: vi.fn(async () => a.recording),
    openRecordingChat: vi.fn(async () => ({ session: { id: "s1" } })),
  };
}

describe("F13/M6 · página da entrevista", () => {
  it("relatório na ordem aprovada, alerta do sorriso, regra de uso e quadros", async () => {
    renderApp({ api: api() as never, initialUrl: "/entrevistas/r1" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrevista técnica" }),
    ).toBeInTheDocument();
    const report = screen.getByRole("region", { name: "Relatório do recrutador" });
    const titles = within(report)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(titles).toEqual([
      "Veredito",
      "O que você falou e não deveria",
      "Respostas erradas ou incompletas",
      "O que funcionou",
      "Discurso e forma",
      "Sorriso e expressão",
      "Reações e anotações",
      "Câmera, iluminação e áudio",
      "Ficha de cada presente",
      "Três treinos",
      "Limitações",
    ]);
    expect(within(report).getByText(/rosto de Alex Souza não foi detectado/)).toBeInTheDocument();
    expect(within(report).getByText(/\[completar: um índice seu\]/)).toBeInTheDocument();
    expect(within(report).getByText("Possivelmente desfavorável")).toBeInTheDocument();
    expect(screen.getByText(/nada pode ser publicado/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Quadro em 02:06/ })).toHaveAttribute(
      "src",
      "/api/recordings/r1/frames/f01-001260.jpg",
    );
  });

  it("tempo no texto leva o vídeo ao trecho", async () => {
    renderApp({ api: api() as never, initialUrl: "/entrevistas/r1" });
    const report = await screen.findByRole("region", { name: "Relatório do recrutador" });
    await userEvent.click(
      within(report).getAllByRole("button", { name: "Ir para 01:37" })[0] as HTMLElement,
    );
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.currentTime).toBe(97);
  });

  it("quem é quem: confirmar o candidato e corrigir quem falou um turno; refazer o relatório", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/entrevistas/r1" });
    const people = await screen.findByRole("region", { name: "Quem é quem" });
    expect(within(people).getByText(/Confirme/)).toBeInTheDocument();
    await userEvent.click(
      within(people).getByRole("button", { name: "Marcar Marina Duarte como você" }),
    );
    await waitFor(() =>
      expect(a.patchRecordingPerson).toHaveBeenCalledWith("r1", "m", { isCandidate: true }),
    );
    const transcript = screen.getByRole("region", { name: "Transcrição" });
    await userEvent.selectOptions(within(transcript).getByLabelText("Quem falou o turno 1"), "m");
    await waitFor(() => expect(a.patchRecordingTurn).toHaveBeenCalledWith("r1", "t1", "m"));
    await userEvent.click(screen.getByRole("button", { name: "Refazer o relatório" }));
    await waitFor(() => expect(a.regenerateRecordingReport).toHaveBeenCalledWith("r1"));
  });

  it("em análise: etapa e porcentagem", async () => {
    const a = analysis({ state: "analyzing", step: "transcribe", progress: 23 });
    renderApp({ api: api({ ...a, report: null }) as never, initialUrl: "/entrevistas/r1" });
    const bar = await screen.findByRole("progressbar", { name: /Transcrição/ });
    expect(bar).toHaveAttribute("aria-valuenow", "23");
  });
});
