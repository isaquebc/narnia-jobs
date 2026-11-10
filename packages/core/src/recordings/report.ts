import {
  INTERVIEW_SCORE_WEIGHTS,
  type InterviewReportDraft,
  type InterviewScore,
  type InterviewSetupKey,
  type RecordingAnalysis,
  type RecordingReportContent,
  type Reliability,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { getCard } from "../profile/cards";
import { recordingAnalysis } from "./analysis";

/**
 * F13/M5 · entrada e checagem do relatório do recrutador (plans/plan-v0/tasks/F13 §2.5). O código monta a transcrição
 * numerada e o resumo; depois confere o que o modelo devolveu, nos moldes do `assembleCv`: citação literal na pessoa
 * certa (senão corrigida pelo texto real ou removida), segundo exato pelas palavras, tempos que existem, uma leitura
 * por anotação e o alerta do sorriso, que nunca depende do modelo (F13-4).
 */
export const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
};

const roleOf = (isCandidate: boolean) => (isCandidate ? "candidato" : "entrevista");

/** `[n] mm:ss–mm:ss Pk (nome, papel): texto`, um turno por linha. */
export function formatTranscript(a: RecordingAnalysis): string {
  const persons = new Map(a.persons.map((p) => [p.id, p]));
  return a.turns
    .map((t) => {
      const p = t.personId ? persons.get(t.personId) : undefined;
      const who = p
        ? `${p.key} (${p.name ?? "sem nome"}, ${roleOf(p.isCandidate)})`
        : "P? (sem nome, desconhecido)";
      return `[${t.idx}] ${mmss(t.start)}–${mmss(t.end)} ${who}: ${t.text}`;
    })
    .join("\n");
}

export interface FrameReading {
  file: string;
  observed: string;
  hypothesis: string;
}

const pick = (o: unknown, keys: string[]) =>
  o && typeof o === "object"
    ? Object.fromEntries(
        keys.filter((k) => k in (o as object)).map((k) => [k, (o as Record<string, unknown>)[k]]),
      )
    : null;

const period = (start?: string | null, end?: string | null, current?: boolean) =>
  [start ?? "?", current ? "atual" : (end ?? "?")].join(" – ");

/**
 * Dados de carreira da pessoa (os fatos verificados, sem o que ela ocultou no perfil e sem remuneração): o recrutador
 * confere as respostas contra o histórico real e escreve a sugestão com fatos dela em vez de `[completar: …]`.
 */
export function buildCandidateBackground(repos: Repos, profileId: string) {
  const hidden = new Set(
    repos.emphasis
      .list(profileId)
      .filter((e) => e.mode === "hidden")
      .map((e) => `${e.factKind}:${e.factId}`),
  );
  const visible = (kind: string, id: string) => !hidden.has(`${kind}:${id}`);
  const achievements = repos.facts.achievements.list();
  let card: string | null = null;
  try {
    card = getCard(repos, profileId).text;
  } catch {
    card = null;
  }
  return {
    card,
    experiences: repos.facts.experiences
      .list()
      .filter((e) => visible("experience", e.id))
      .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
      .slice(0, 10)
      .map((e) => ({
        company: e.company,
        title: e.title,
        period: period(e.startDate, e.endDate, e.isCurrent),
        summary: e.summary ?? null,
        tech: e.tech ?? [],
        achievements: achievements
          .filter((a) => a.experienceId === e.id)
          .slice(0, 8)
          .map((a) => (a.metric ? `${a.text} (${a.metric})` : a.text)),
      })),
    projects: repos.facts.projects
      .list()
      .filter((p) => visible("project", p.id))
      .slice(0, 12)
      .map((p) => ({
        name: p.name,
        role: p.role ?? null,
        description: p.description ?? null,
        tech: p.tech ?? [],
      })),
    education: repos.facts.education.list().map((e) => ({
      institution: e.institution,
      course: e.course ?? null,
      degree: e.degree ?? null,
      period: period(e.startDate, e.endDate),
      status: e.status ?? null,
    })),
    skills: repos.facts.skills
      .list()
      .filter((s) => visible("skill", s.id))
      .slice(0, 60)
      .map((s) => s.name),
    languages: repos.facts.languages.list().map((l) => ({ name: l.name, level: l.level ?? null })),
  };
}

/** Resumo para o modelo: entrevista, vaga e CV enviado, pessoas com medições, eventos, quadros e o histórico. */
export function buildInterviewBrief(
  repos: Repos,
  id: string,
  frames: FrameReading[] = [],
): Record<string, unknown> & { persons: unknown[]; events: unknown[]; frames: unknown[] } {
  const a = recordingAnalysis(repos, id);
  const rec = a.recording;
  const keyOf = new Map(a.persons.map((p) => [p.id, p.key]));
  const app = rec.jobApplicationId ? repos.jobApplications.get(rec.jobApplicationId) : null;
  const posting = app ? repos.postings.get(app.postingId) : null;
  const cv = app ? repos.documents.versionById(app.cv.versionId) : null;
  const profile = repos.profiles.get(rec.profileId);
  const stage = app?.stages.find((s) => s.id === rec.stageId)?.name ?? null;
  const previous = (
    rec.jobApplicationId ? repos.recordings.listByApplication(rec.jobApplicationId) : []
  )
    .filter((r) => r.id !== id && r.createdAt < rec.createdAt)
    .map((r) => {
      const rep = repos.recordingAnalysis.latestReport(r.id);
      return rep
        ? {
            title: r.title ?? r.fileName,
            stage: app?.stages.find((s) => s.id === r.stageId)?.name ?? null,
            date: r.createdAt.slice(0, 10),
            verdict: rep.content.verdict,
            drills: rep.content.drills.map((d) => d.title),
          }
        : null;
    })
    .filter(Boolean);
  const frameByFile = new Map(a.frames.map((f) => [f.file, f]));
  return {
    locale: "pt-BR",
    interview: {
      title: rec.title,
      stage,
      duration: rec.durationS ? mmss(rec.durationS) : null,
      meetingStart: rec.meetingStartS !== null ? mmss(rec.meetingStartS) : null,
      language: rec.language,
      voicesApproximate: rec.approximate,
      measurements: a.measurements,
    },
    posting: posting
      ? {
          company: posting.company,
          title: posting.title,
          description: (posting.jdText ?? "").slice(0, 6000),
        }
      : null,
    cvSent: cv?.textBody ? cv.textBody.slice(0, 6000) : null,
    profile: profile
      ? { targetTitle: profile.targetTitle, seniority: profile.seniority, area: profile.area }
      : null,
    candidate: buildCandidateBackground(repos, rec.profileId),
    persons: a.persons.map((p) => {
      const m = p.measurements as Record<string, unknown>;
      return {
        key: p.key,
        name: p.name,
        role: roleOf(p.isCandidate),
        nameConfirmed: p.nameSource === "user",
        talkShare: m.talkShare ?? null,
        voice: pick(m.voice, [
          "turns",
          "talk_s",
          "wpm",
          "longest_turn_s",
          "pauses",
          "long_pauses",
          "fillers",
          "fillers_per_min",
          "pitch_spread_semitones",
          "response_latency_median_s",
          "low_confidence_words",
        ]),
        audio: pick(m.levels, ["rms_dbfs", "peak_dbfs", "clipping_ratio", "snr_db"]),
        face: m.face ?? {
          reliability: null,
          note: "rosto não detectado (miniatura pequena ou câmera fechada)",
        },
      };
    }),
    events: a.events.map((e) => ({
      key: e.key,
      type: e.type,
      level: e.level,
      person: e.personId ? (keyOf.get(e.personId) ?? null) : null,
      at: mmss(e.t),
      durationS: e.durationS,
      cue: e.data.cue ?? null,
      turn: e.turnIdx,
      frame: e.frame,
    })),
    frames: frames.map((f) => {
      const fr = frameByFile.get(f.file);
      return {
        file: f.file,
        at: fr ? mmss(fr.t) : null,
        person: fr?.personId ? (keyOf.get(fr.personId) ?? null) : null,
        events: fr?.events ?? [],
        observed: f.observed,
        hypothesis: f.hypothesis,
      };
    }),
    previousInterviews: previous,
  };
}

// ── checagem ────────────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

interface Tok {
  tok: string;
  word: number;
}
interface TurnWords {
  idx: number;
  words: Array<{ w: string; start: number }>;
  toks: Tok[];
}

function tokenize(words: Array<{ w: string; start: number }>): Tok[] {
  return words.flatMap((w, i) => norm(w.w).map((tok) => ({ tok, word: i })));
}

/** Procura a citação no turno: exata (sequência de tokens) ou aproximada (≥ 70 % dos tokens numa janela do tamanho). */
function locate(
  tw: TurnWords,
  quote: string,
): { exact: boolean; text: string; t: number; score: number } | null {
  const q = norm(quote);
  if (!q.length || tw.toks.length < q.length) return null;
  let best: { i: number; score: number } | null = null;
  for (let i = 0; i + q.length <= tw.toks.length; i++) {
    const win = tw.toks.slice(i, i + q.length).map((t) => t.tok);
    if (win.every((t, k) => t === q[k])) {
      best = { i, score: 1 };
      break;
    }
    const bag = new Map<string, number>();
    for (const t of win) bag.set(t, (bag.get(t) ?? 0) + 1);
    let hit = 0;
    for (const t of q) {
      const n = bag.get(t) ?? 0;
      if (n > 0) {
        hit++;
        bag.set(t, n - 1);
      }
    }
    const score = hit / q.length;
    if (!best || score > best.score) best = { i, score };
  }
  if (!best || best.score < 0.7) return null;
  const first = tw.toks[best.i]?.word ?? 0;
  const last = tw.toks[best.i + q.length - 1]?.word ?? first;
  return {
    exact: best.score === 1,
    text: tw.words
      .slice(first, last + 1)
      .map((w) => w.w)
      .join(" "),
    t: tw.words[first]?.start ?? 0,
    score: best.score,
  };
}

const TIME_RE = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[–-](\d{1,2}):(\d{2})(?::(\d{2}))?)?\]/g;
const toSec = (a?: string, b?: string, c?: string) =>
  c !== undefined ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);

/** Tira de textos livres os `[mm:ss]` que não existem no vídeo. */
function fixTimes(text: string, duration: number, warn: (w: string) => void): string {
  return text
    .replace(TIME_RE, (m, a, b, c, d, e, f) => {
      const start = toSec(a, b, c);
      const end = d !== undefined ? toSec(d, e, f) : start;
      if (start <= duration + 1 && end <= duration + 1) return m;
      warn(`tempo inexistente ${m} retirado do texto`);
      return "";
    })
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/ {2,}/g, " ");
}

function deepFixTimes<T>(
  v: T,
  duration: number,
  warn: (w: string) => void,
  skip = new Set(["quote"]),
): T {
  if (typeof v === "string") return fixTimes(v, duration, warn) as T;
  if (Array.isArray(v)) return v.map((x) => deepFixTimes(x, duration, warn, skip)) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        skip.has(k) ? x : deepFixTimes(x, duration, warn, skip),
      ]),
    ) as T;
  return v;
}

/** Alerta do sorriso (F13-4): com a % de detecção e o tamanho do rosto, nunca omitido quando a detecção não é boa. */
export function smileAlert(a: RecordingAnalysis): {
  alert: string | null;
  reliability: Reliability | null;
} {
  const c = a.persons.find((p) => p.isCandidate);
  if (!c) return { alert: null, reliability: null };
  const face = (
    c.measurements as {
      face?: {
        reliability?: { detected_pct: number; face_px: number; level: string };
        smile_ratio?: number;
      };
    }
  ).face;
  const who = c.name ?? c.key;
  if (!face?.reliability)
    return {
      alert: `Alerta de confiabilidade: o rosto de ${who} não foi detectado (0% do tempo); não há leitura do sorriso pelo vídeo.`,
      reliability: { detectedPct: 0, facePx: 0, level: "poor" },
    };
  const r = face.reliability;
  const reliability: Reliability = {
    detectedPct: r.detected_pct,
    facePx: r.face_px,
    level: r.level as Reliability["level"],
  };
  if (r.level === "good") return { alert: null, reliability };
  const smile = Math.round(100 * (face.smile_ratio ?? 0));
  return {
    alert: `Alerta de confiabilidade ${r.level === "poor" ? "baixa" : "média"}: o rosto de ${who} foi detectável em ${String(r.detected_pct).replace(".", ",")}% do tempo, com cerca de ${r.face_px} px; o sorriso medido (${smile}% do tempo detectado) não sustenta conclusão.`,
    reliability,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp10 = (n: number) => Math.max(0, Math.min(10, n));
const SETUP_LABEL: Record<InterviewSetupKey, string> = {
  camera: "câmera",
  audio: "áudio",
  noise: "ruído",
};

/**
 * Câmera, áudio e ruído da pessoa candidata pelas medições (mesmo vídeo, mesma nota). A câmera só conta com o rosto
 * detectável: na gravação da própria tela o seu rosto é uma miniatura, que não é o que quem entrevistou viu.
 */
export function setupScores(a: RecordingAnalysis): InterviewScore["setup"] {
  const c = a.persons.find((p) => p.isCandidate);
  const m = (c?.measurements ?? {}) as {
    face?: {
      reliability?: { level: string; face_px: number; detected_pct: number };
      camera?: { flags?: string[] };
    } | null;
    levels?: { rms_dbfs?: number; clipping_ratio?: number; snr_db?: number } | null;
  };
  const out: InterviewScore["setup"] = [];
  const face = m.face;
  if (!face?.reliability || face.reliability.level === "poor") {
    out.push({
      key: "camera",
      points: null,
      reason:
        "não medida: o seu rosto não ficou detectável na gravação (miniatura ou câmera fechada), e a miniatura não é o que quem entrevistou viu",
    });
  } else {
    const PENALTY: Record<string, [number, string]> = {
      small_face: [3, "rosto pequeno no quadro"],
      dark: [3, "rosto escuro"],
      overexposed: [2, "rosto estourado de luz"],
      backlit: [2, "luz atrás de você"],
      blurry: [2, "imagem sem foco"],
    };
    const flags = (face.camera?.flags ?? []).filter((f) => f in PENALTY);
    const points = clamp10(10 - flags.reduce((s, f) => s + (PENALTY[f]?.[0] ?? 0), 0));
    out.push({
      key: "camera",
      points,
      reason: flags.length
        ? flags.map((f) => PENALTY[f]?.[1]).join(", ")
        : `rosto nítido e bem iluminado (${face.reliability.face_px} px)`,
    });
  }
  const lv = m.levels;
  if (typeof lv?.rms_dbfs !== "number") {
    out.push({ key: "audio", points: null, reason: "não medido: sem falas suas identificadas" });
  } else {
    const rms = lv.rms_dbfs;
    const off = rms < -30 ? -30 - rms : rms > -12 ? rms - -12 : 0;
    const clip = lv.clipping_ratio ?? 0;
    const clipLoss = clip > 0.01 ? 5 : clip > 0.001 ? 2 : 0;
    const points = round1(clamp10(10 - Math.min(5, off / 2) - clipLoss));
    const why = [
      off
        ? `volume ${rms < -30 ? "baixo" : "alto"} (${round1(rms)} dBFS)`
        : `volume bom (${round1(rms)} dBFS)`,
      ...(clipLoss ? ["som saturando em alguns trechos"] : []),
    ];
    out.push({ key: "audio", points, reason: why.join(", ") });
  }
  if (typeof lv?.snr_db !== "number") {
    out.push({ key: "noise", points: null, reason: "não medido: sem falas suas identificadas" });
  } else {
    const points = round1(clamp10((lv.snr_db - 5) / 3));
    out.push({
      key: "noise",
      points,
      reason: `voz ${round1(lv.snr_db)} dB acima do fundo (a plataforma já filtra parte do ruído)`,
    });
  }
  return out;
}

function interviewScore(
  draft: InterviewReportDraft,
  a: RecordingAnalysis,
  candTurns: number[],
  warn: (w: string) => void,
): InterviewScore {
  const exists = new Set(a.turns.map((t) => t.idx));
  const setup = setupScores(a);
  const measured = setup.filter((s) => s.points !== null).map((s) => s.points as number);
  const content = (["completeness", "objectivity", "clarity"] as const).map((key) => {
    const s = draft.scores?.[key];
    if (!candTurns.length || !s)
      return {
        key,
        points: null,
        weight: INTERVIEW_SCORE_WEIGHTS[key],
        reason: "não avaliado: nenhuma fala sua foi identificada na transcrição",
        turns: [],
      };
    const bad = s.turns.filter((t) => !exists.has(t));
    if (bad.length) warn(`nota (${key}): turnos inexistentes retirados: ${bad.join(", ")}`);
    return {
      key,
      points: clamp10(Math.round(s.points)),
      weight: INTERVIEW_SCORE_WEIGHTS[key],
      reason: s.reason,
      turns: s.turns.filter((t) => exists.has(t)),
    };
  });
  const criteria: InterviewScore["criteria"] = [
    ...content,
    {
      key: "setup",
      points: measured.length
        ? round1(measured.reduce((x, y) => x + y, 0) / measured.length)
        : null,
      weight: INTERVIEW_SCORE_WEIGHTS.setup,
      reason: setup
        .map((s) => `${SETUP_LABEL[s.key]}: ${s.points === null ? "não medido" : s.points}`)
        .join(" · "),
      turns: [],
    },
  ];
  const scored = criteria.filter((c) => c.points !== null);
  const overall =
    content.some((c) => c.points !== null) && scored.length
      ? Math.round(
          (10 * scored.reduce((s, c) => s + c.weight * (c.points as number), 0)) /
            scored.reduce((s, c) => s + c.weight, 0),
        )
      : null;
  return { overall, criteria, setup };
}

export function checkInterviewReport(
  draft: InterviewReportDraft,
  a: RecordingAnalysis,
  turnWords?: Array<{ idx: number; words: unknown[] }>,
): { content: RecordingReportContent; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (w: string) => warnings.push(w);
  const duration = a.recording.durationS ?? Math.max(0, ...a.turns.map((t) => t.end));
  const candidate = a.persons.find((p) => p.isCandidate)?.id ?? null;
  const turnByIdx = new Map(a.turns.map((t) => [t.idx, t]));
  const isCand = (idx: number) => {
    const t = turnByIdx.get(idx);
    return Boolean(t) && (!candidate || t?.personId === candidate);
  };
  const wordsOf = new Map(
    (turnWords ?? []).map((x) => [x.idx, x.words as Array<{ w: string; start: number }>]),
  );
  const tw = (idx: number): TurnWords => {
    const t = turnByIdx.get(idx);
    const words =
      wordsOf.get(idx) && (wordsOf.get(idx) as unknown[]).length
        ? (wordsOf.get(idx) as Array<{ w: string; start: number }>)
        : // sem as palavras com tempo: distribui o turno por igual (aproximado)
          (t?.text.split(/\s+/) ?? []).map((w, i, all) => ({
            w,
            start:
              (t?.start ?? 0) + (((t?.end ?? 0) - (t?.start ?? 0)) * i) / Math.max(1, all.length),
          }));
    return { idx, words, toks: tokenize(words) };
  };
  const candTurns = a.turns.filter((t) => isCand(t.idx)).map((t) => t.idx);

  const fixQuote = <T extends { turn: number; quote: string }>(item: T, section: string) => {
    const tries = [
      ...(isCand(item.turn) ? [item.turn] : []),
      ...candTurns.filter((i) => i !== item.turn),
    ];
    let best: { idx: number; hit: NonNullable<ReturnType<typeof locate>> } | null = null;
    for (const idx of tries) {
      const hit = locate(tw(idx), item.quote);
      if (hit?.exact) return { ...item, turn: idx, t: hit.t };
      if (hit && (!best || hit.score > best.hit.score)) best = { idx, hit };
    }
    if (best) {
      warn(`${section}: citação corrigida pelo texto real do turno ${best.idx}`);
      return { ...item, turn: best.idx, quote: best.hit.text, t: best.hit.t };
    }
    warn(
      `${section}: citação removida (não está na transcrição da pessoa candidata): "${item.quote.slice(0, 60)}"`,
    );
    return null;
  };
  const keep = <T>(xs: Array<T | null>) => xs.filter((x): x is T => x !== null);

  const answers = keep(
    draft.answers.map((ans) => {
      const q = turnByIdx.get(ans.questionTurn);
      if (!q || (candidate && q.personId === candidate)) {
        warn(
          `respostas: pergunta no turno ${ans.questionTurn} não existe ou é da pessoa candidata; item removido`,
        );
        return null;
      }
      const answerTurns = ans.answerTurns.filter((i) => isCand(i));
      if (!answerTurns.length) {
        warn(
          `respostas: nenhum turno de resposta válido para a pergunta do turno ${ans.questionTurn}; item removido`,
        );
        return null;
      }
      return { ...ans, answerTurns, t: q.start };
    }),
  );

  const events = new Map(a.events.map((e) => [e.key, e]));
  const personKeys = new Set(a.persons.map((p) => p.key));
  // o modelo às vezes escreve "P1 (Marina)": fica o rótulo
  const keyOf = <T extends { person: string }>(x: T): T => ({
    ...x,
    person: /P\d+/.exec(x.person)?.[0] ?? x.person,
  });
  const noteEvents = a.events.filter((e) => e.type === "note");
  const notes = noteEvents.map((e) => {
    const n = draft.notes.find((x) => x.event === e.key);
    return n
      ? { ...n, t: e.t }
      : {
          event: e.key,
          t: e.t,
          reading: "indeterminate" as const,
          reason: "Sem sinal suficiente para uma leitura.",
        };
  });
  for (const n of draft.notes)
    if (!noteEvents.some((e) => e.key === n.event))
      warn(`anotações: evento ${n.event} não existe; leitura removida`);

  const content: RecordingReportContent = {
    ...draft,
    shouldNotHaveSaid: keep(draft.shouldNotHaveSaid.map((x) => fixQuote(x, "o que não deveria"))),
    answers,
    worked: keep(draft.worked.map((x) => fixQuote(x, "o que funcionou"))),
    smile: { observations: draft.smile.observations, ...smileAlert(a) },
    reactions: draft.reactions
      .map(keyOf)
      .filter((r) => personKeys.has(r.person) && (r.event === null || events.has(r.event)))
      .map((r) => ({ ...r, t: r.event ? (events.get(r.event)?.t ?? null) : null })),
    notes,
    setup: {
      ...draft.setup,
      people: draft.setup.people.map(keyOf).filter((p) => personKeys.has(p.person)),
    },
    people: draft.people.map(keyOf).filter((p) => personKeys.has(p.person)),
    drills: draft.drills.slice(0, 3),
    score: interviewScore(draft, a, candTurns, warn),
  };
  return { content: deepFixTimes(content, duration, warn), warnings };
}
