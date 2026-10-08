import type { ReadingKind, SegmentDivergence, SegmentInput } from "../db/repos/readings";

export interface ReadingInputText {
  kind: ReadingKind;
  text: string;
  /** 0–1; leituras abaixo de MIN_QUALITY ou quase vazias são descartadas. */
  quality?: number;
}

export interface ConsolidationResult {
  text: string;
  segments: SegmentInput[];
  usedKinds: ReadingKind[];
}

const MIN_QUALITY = 0.05;
const MIN_CHARS = 20;
const SEGMENT_MATCH = 0.5;
const LINE_MATCH = 0.6;
const PRIORITY: Record<ReadingKind, number> = { model_read: 2, text_layer: 1, ocr: 0 };

const HEADINGS =
  /^(resumo|sumário|summary|objetivo|objective|experiência|experiencia|experience|formação|formacao|education|educação|skills|habilidades|competências|competencias|idiomas|languages|certificações|certificacoes|certifications|projetos|projects|publicações|publications|cursos|courses|contato|contact|perfil|profile)\b/i;

interface Segment {
  sectionHint: string | null;
  text: string;
}

export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 40) return false;
  if (HEADINGS.test(t) && t.split(/\s+/).length <= 3) return true;
  const letters = t.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 5;
}

export function segmentText(text: string): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  const flush = () => {
    if (current?.text.trim()) segments.push({ ...current, text: current.text.trim() });
    current = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (isHeadingLine(line)) {
      flush();
      current = { sectionHint: line, text: line };
      continue;
    }
    if (!current) current = { sectionHint: null, text: line };
    else current.text += `\n${line}`;
  }
  flush();
  return segments;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Coeficiente de Dice sobre tokens. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of tb) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      common++;
      counts.set(t, c - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

function bestMatch<T>(items: T[], score: (t: T) => number, threshold: number): T | null {
  let best: T | null = null;
  let bestScore = threshold;
  for (const it of items) {
    const s = score(it);
    if (s >= bestScore) {
      best = it;
      bestScore = s;
    }
  }
  return best;
}

function majority(values: Map<ReadingKind, string>, fallback: string): string {
  const counts = new Map<string, number>();
  for (const v of values.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
  let chosen = fallback;
  let max = 1;
  for (const [v, c] of counts) {
    if (c > max) {
      max = c;
      chosen = v;
    }
  }
  return chosen;
}

interface LineOutcome {
  text: string;
  agreement: number;
  divergences: SegmentDivergence[];
}

/** Uma linha do segmento base contra as variantes das outras leituras: voto por token (mesma contagem) ou por linha. */
function resolveLine(baseKind: ReadingKind, variants: Map<ReadingKind, string>): LineOutcome {
  const base = variants.get(baseKind) as string;
  const distinct = new Set(variants.values());
  if (distinct.size === 1) return { text: base, agreement: 1, divergences: [] };
  const split = new Map([...variants].map(([k, v]) => [k, v.split(/\s+/)] as const));
  const lengths = new Set([...split.values()].map((t) => t.length));
  const divergences: SegmentDivergence[] = [];
  if (lengths.size === 1) {
    const baseTokens = split.get(baseKind) as string[];
    const out: string[] = [];
    let agreeing = 0;
    for (let j = 0; j < baseTokens.length; j++) {
      const values = new Map<ReadingKind, string>();
      for (const [k, t] of split) values.set(k, t[j] as string);
      const chosen = majority(values, baseTokens[j] as string);
      out.push(chosen);
      if (new Set(values.values()).size > 1) {
        divergences.push({
          token: baseTokens[j] as string,
          values: Object.fromEntries(values),
          chosen,
        });
      }
    }
    const final = out.join(" ");
    for (const v of variants.values()) if (v === final) agreeing++;
    return { text: final, agreement: agreeing / variants.size, divergences };
  }
  const chosen = majority(variants, base);
  let agreeing = 0;
  for (const v of variants.values()) if (v === chosen) agreeing++;
  divergences.push({ token: base, values: Object.fromEntries(variants), chosen });
  return { text: chosen, agreement: agreeing / variants.size, divergences };
}

/**
 * Consolidação das leituras (decisão F01-22): a leitura de maior qualidade dá o esqueleto; cada segmento é alinhado
 * por similaridade nas demais; dentro do segmento, linhas e tokens divergentes são decididos por maioria (2 de 3),
 * com a origem e a concordância registradas por segmento para a tela de revisão.
 */
export function consolidateReadings(readings: ReadingInputText[]): ConsolidationResult {
  if (readings.length === 0) throw new Error("Nenhuma leitura para consolidar");
  const usable = readings.filter(
    (r) => (r.quality ?? 1) >= MIN_QUALITY && r.text.trim().length >= MIN_CHARS,
  );
  if (usable.length === 0) return { text: "", segments: [], usedKinds: [] };
  const sorted = [...usable].sort(
    (a, b) => (b.quality ?? 1) - (a.quality ?? 1) || PRIORITY[b.kind] - PRIORITY[a.kind],
  );
  const base = sorted[0] as ReadingInputText;
  const others = sorted.slice(1).map((r) => ({ kind: r.kind, segments: segmentText(r.text) }));
  const baseSegments = segmentText(base.text);

  const segments: SegmentInput[] = baseSegments.map((seg, index) => {
    const matched = new Map<ReadingKind, Segment>([[base.kind, seg]]);
    for (const o of others) {
      const m = bestMatch(o.segments, (s) => similarity(s.text, seg.text), SEGMENT_MATCH);
      if (m) matched.set(o.kind, m);
    }
    const baseLines = seg.text.split("\n");
    const otherLines = new Map(
      [...matched]
        .filter(([k]) => k !== base.kind)
        .map(([k, s]) => [k, s.text.split("\n")] as const),
    );
    const outLines: string[] = [];
    const divergences: SegmentDivergence[] = [];
    let agreementSum = 0;
    baseLines.forEach((line, li) => {
      const variants = new Map<ReadingKind, string>([[base.kind, line]]);
      for (const [k, lines] of otherLines) {
        const candidate =
          lines.length === baseLines.length
            ? (lines[li] as string)
            : bestMatch(lines, (l) => similarity(l, line), LINE_MATCH);
        if (candidate !== null && candidate !== undefined) variants.set(k, candidate);
      }
      const outcome = resolveLine(base.kind, variants);
      outLines.push(outcome.text);
      divergences.push(...outcome.divergences);
      agreementSum += outcome.agreement;
    });
    return {
      index,
      sectionHint: seg.sectionHint,
      text: outLines.join("\n"),
      origin: base.kind,
      agreement: Math.round((agreementSum / baseLines.length) * 1000) / 1000,
      divergences,
    };
  });

  return {
    text: segments.map((s) => s.text).join("\n\n"),
    segments,
    usedKinds: usable.map((r) => r.kind),
  };
}
