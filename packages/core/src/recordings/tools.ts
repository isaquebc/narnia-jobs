import { RECORDING_TOOLS, type RecordingToolName } from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import { recordingAnalysis } from "./analysis";
import { RecordingError } from "./index";
import { formatTranscript, mmss } from "./report";

/** F13/M5 · handlers das tools `recording.*` (contratos em `packages/shared/src/mcp/recording.ts`). */
type In<N extends RecordingToolName> = z.infer<(typeof RECORDING_TOOLS)[N]["input"]>;
type Out<N extends RecordingToolName> = z.infer<(typeof RECORDING_TOOLS)[N]["output"]>;
export type RecordingToolHandlers = {
  [N in RecordingToolName]: (input: unknown) => Promise<Out<N>>;
};

const STATE: Record<string, string> = {
  uploading: "enviando",
  uploaded: "enviada, aguardando análise",
  analyzing: "analisando",
  ready: "analisada",
  failed: "falhou",
};
const MAX_TURNS = 80;

export const recordingUrl = (id: string, t?: number) =>
  `/entrevistas/${id}${t !== undefined ? `?t=${Math.floor(t)}` : ""}`;

export function createRecordingTools(repos: Repos): RecordingToolHandlers {
  const wrap = <N extends RecordingToolName>(name: N, impl: (input: In<N>) => Out<N>) => {
    const def = RECORDING_TOOLS[name];
    return async (raw: unknown): Promise<Out<N>> =>
      def.output.parse(impl(def.input.parse(raw) as In<N>)) as Out<N>;
  };
  const must = (id: string) => {
    if (!repos.recordings.get(id))
      throw new RecordingError("not_found", `Entrevista não encontrada: ${id}`);
    return recordingAnalysis(repos, id);
  };
  const line = (r: {
    id: string;
    title: string | null;
    fileName: string;
    createdAt: string;
    state: string;
    stageId: string | null;
    jobApplicationId: string | null;
    durationS: number | null;
  }) => {
    const app = r.jobApplicationId ? repos.jobApplications.get(r.jobApplicationId) : null;
    const stage = app?.stages.find((s) => s.id === r.stageId)?.name;
    return [
      r.title ?? r.fileName,
      stage ? `etapa ${stage}` : null,
      r.createdAt.slice(0, 10),
      r.durationS ? mmss(r.durationS) : null,
      STATE[r.state] ?? r.state,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  return {
    "recording.list": wrap("recording.list", (i) => {
      const profileId = i.profileId ?? repos.profiles.active()?.id ?? null;
      const list = i.jobApplicationId
        ? repos.recordings.listByApplication(i.jobApplicationId)
        : profileId
          ? repos.recordings.listByProfile(profileId)
          : [];
      return { items: list.map((r) => ({ id: r.id, line: line(r), url: recordingUrl(r.id) })) };
    }),
    "recording.get": wrap("recording.get", (i) => {
      const a = must(i.id);
      const keyOf = new Map(a.persons.map((p) => [p.id, p.key]));
      const report = a.report?.content ?? null;
      return {
        id: a.recording.id,
        line: line(a.recording),
        url: recordingUrl(a.recording.id),
        state: a.recording.state,
        persons: a.persons.map((p) => {
          const m = p.measurements as {
            talkShare?: number;
            face?: { reliability?: { level: string; detected_pct: number } };
          };
          return {
            key: p.key,
            line: [
              p.name ?? "sem nome",
              p.isCandidate ? "candidato(a)" : "entrevista",
              m.talkShare !== undefined ? `${Math.round(100 * m.talkShare)}% da fala` : null,
              m.face?.reliability
                ? `rosto ${m.face.reliability.level} (${m.face.reliability.detected_pct}% detectável)`
                : "rosto não detectado",
            ]
              .filter(Boolean)
              .join(" · "),
          };
        }),
        events: a.events.map((e) => ({
          key: e.key,
          line: [
            mmss(e.t),
            e.type === "note"
              ? `anotação ${e.level === "confirmed" ? "confirmada" : "provável"}`
              : e.type,
            e.personId ? keyOf.get(e.personId) : null,
            e.reading ? `leitura: ${e.reading}` : null,
            e.reason,
          ]
            .filter(Boolean)
            .join(" · "),
        })),
        report: report as unknown as Record<string, unknown> | null,
        limitations: [
          ...(a.recording.approximate
            ? ["Vozes separadas por aproximação (sem token do Hugging Face)."]
            : []),
          ...(report?.limitations ?? []),
        ],
      };
    }),
    "recording.transcript": wrap("recording.transcript", (i) => {
      const a = must(i.id);
      const all = formatTranscript(a).split("\n");
      const from = Math.max(0, i.fromTurn ?? 0);
      const to = Math.min(
        a.turns.length - 1,
        i.toTurn ?? from + MAX_TURNS - 1,
        from + MAX_TURNS - 1,
      );
      const lines = a.turns
        .filter((t) => t.idx >= from && t.idx <= to)
        .map((t) => ({
          turn: t.idx,
          line: all[t.idx] ?? "",
          url: recordingUrl(a.recording.id, t.start),
        }));
      return { lines, total: a.turns.length };
    }),
  };
}
