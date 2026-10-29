import type { RecallReport } from "@narnia-jobs/core";
import type { EvalCaseReport } from "./run";

/**
 * Relatório de execução do chat (F04-fix-fundamentacao, FF-3, 2026-10-29): cada marco grava as medidas da rodada em
 * `evals/reports/<data>-<rótulo>.{md,json}` e compara com a anterior. Latência por turno (p50/p95), tokens e custo por
 * conversa, tools e buscas por turno, tamanho das respostas, notas dos avaliadores e do juiz e o recall da busca.
 */
export interface RunSummary {
  conversations: number;
  errors: number;
  turns: number;
  turnMsP50: number | null;
  turnMsP95: number | null;
  toolsPerTurn: number | null;
  searchesPerTurn: number | null;
  replyCharsAvg: number | null;
  tokensPerConversation: number | null;
  costPerConversation: number | null;
  /** Fração dos avaliadores de código que passaram. */
  graders: number | null;
  /** Nota média do juiz. */
  judge: number | null;
  recall: number | null;
}

export interface RunReportJson {
  label: string;
  commit: string | null;
  at: string;
  provider: string;
  samples: number;
  summary: RunSummary;
  recall: RecallReport | null;
  cases: Array<{
    id: string;
    samples: number;
    errors: number;
    graders: number | null;
    judge: number | null;
    turnMsP50: number | null;
    searchesPerTurn: number | null;
  }>;
}

/** Percentil por interpolação linear (null sem valores). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const pos = (v.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (v[lo] as number) + ((v[hi] as number) - (v[lo] as number)) * (pos - lo);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function summarize(list: EvalCaseReport[]) {
  const ok = list.filter((r) => !r.error && r.metrics);
  const m = ok.map((r) => r.metrics as NonNullable<EvalCaseReport["metrics"]>);
  const turnMs = m.flatMap((x) => x.turnMs);
  const results = list.filter((r) => !r.error).flatMap((r) => r.results);
  const judges = list.flatMap((r) => r.judges ?? []).filter((j) => j.name !== "pairwise");
  return {
    turnMs,
    ok,
    m,
    graders: results.length ? results.filter((g) => g.passed).length / results.length : null,
    judge: avg(judges.map((j) => j.score)),
  };
}

export function buildRunReport(o: {
  label: string;
  commit: string | null;
  at: string;
  provider: string;
  /** Uma lista por amostra (a rodada inteira repetida N vezes). */
  samples: EvalCaseReport[][];
  recall?: RecallReport;
}): { json: RunReportJson; markdown: string } {
  const all = o.samples.flat();
  const s = summarize(all);
  const summary: RunSummary = {
    conversations: all.length,
    errors: all.filter((r) => r.error).length,
    turns: s.turnMs.length,
    turnMsP50: percentile(s.turnMs, 0.5),
    turnMsP95: percentile(s.turnMs, 0.95),
    toolsPerTurn: avg(s.m.flatMap((x) => x.toolsPerTurn)),
    searchesPerTurn: avg(s.m.flatMap((x) => x.searchesPerTurn)),
    replyCharsAvg: avg(s.m.flatMap((x) => x.replyChars)),
    tokensPerConversation: avg(s.m.map((x) => x.tokensIn + x.tokensOut)),
    costPerConversation: avg(s.m.map((x) => x.costUsd)),
    graders: s.graders,
    judge: s.judge,
    recall: o.recall?.overall ?? null,
  };
  const ids = [...new Set(all.map((r) => r.id))];
  const cases = ids.map((id) => {
    const list = all.filter((r) => r.id === id);
    const c = summarize(list);
    return {
      id,
      samples: list.length,
      errors: list.filter((r) => r.error).length,
      graders: c.graders,
      judge: c.judge,
      turnMsP50: percentile(c.turnMs, 0.5),
      searchesPerTurn: avg(c.m.flatMap((x) => x.searchesPerTurn)),
    };
  });
  const json: RunReportJson = {
    label: o.label,
    commit: o.commit,
    at: o.at,
    provider: o.provider,
    samples: o.samples.length,
    summary,
    recall: o.recall ?? null,
    cases,
  };
  return { json, markdown: renderReport(json) };
}

const num = (v: number | null, digits = 1) =>
  v === null ? "—" : v.toFixed(digits).replace(".", ",");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const secs = (ms: number | null) => (ms === null ? "—" : `${num(ms / 1000)} s`);
const usd = (v: number | null) => (v === null ? "—" : `US$ ${v.toFixed(3)}`);

function renderReport(r: RunReportJson): string {
  const s = r.summary;
  const lines = [
    `# Relatório ${r.label}`,
    "",
    `${r.at} · commit ${r.commit ?? "?"} · provider ${r.provider} · ${r.samples} amostra(s)`,
    "",
    `- Conversas: ${s.conversations} (${s.errors} com erro) · turnos: ${s.turns}`,
    `- Latência por turno: p50 ${secs(s.turnMsP50)} · p95 ${secs(s.turnMsP95)}`,
    `- Tools por turno: ${num(s.toolsPerTurn)} · buscas (fact_search) por turno: ${num(s.searchesPerTurn)}`,
    `- Tamanho médio da resposta: ${num(s.replyCharsAvg, 0)} caracteres`,
    `- Tokens por conversa: ${num(s.tokensPerConversation, 0)} · custo estimado por conversa: ${usd(s.costPerConversation)}`,
    `- Avaliadores de código: ${pct(s.graders)} · juiz: ${pct(s.judge)}`,
    `- Recall da busca de fatos: ${pct(s.recall)}`,
  ];
  if (r.recall) {
    lines.push("", "## Recall da busca por tipo", "", "| Tipo | Recall |", "|---|---|");
    for (const [cat, v] of Object.entries(r.recall.byCategory))
      lines.push(`| ${cat} | ${pct(v)} |`);
    const misses = r.recall.cases.filter((c) => c.missing.length > 0);
    if (misses.length) {
      lines.push("", "Faltaram:");
      for (const c of misses) lines.push(`- ${c.id}: ${c.missing.join("; ")}`);
    }
  }
  lines.push(
    "",
    "## Por caso",
    "",
    "| Caso | Amostras | Erros | Avaliadores | Juiz | Turno p50 | Buscas/turno |",
    "|---|---|---|---|---|---|---|",
    ...r.cases.map(
      (c) =>
        `| ${c.id} | ${c.samples} | ${c.errors} | ${pct(c.graders)} | ${pct(c.judge)} | ${secs(c.turnMsP50)} | ${num(c.searchesPerTurn)} |`,
    ),
  );
  return `${lines.join("\n")}\n`;
}

/** Comparação de duas rodadas (antes → depois), métrica a métrica. */
export function compareRunReports(a: RunReportJson, b: RunReportJson): string {
  const rows: Array<[string, number | null, number | null, (v: number | null) => string]> = [
    ["Latência p50 (s)", ms(a.summary.turnMsP50), ms(b.summary.turnMsP50), (v) => num(v)],
    ["Latência p95 (s)", ms(a.summary.turnMsP95), ms(b.summary.turnMsP95), (v) => num(v)],
    ["Tools por turno", a.summary.toolsPerTurn, b.summary.toolsPerTurn, (v) => num(v)],
    ["Buscas por turno", a.summary.searchesPerTurn, b.summary.searchesPerTurn, (v) => num(v)],
    ["Resposta (caracteres)", a.summary.replyCharsAvg, b.summary.replyCharsAvg, (v) => num(v, 0)],
    [
      "Tokens por conversa",
      a.summary.tokensPerConversation,
      b.summary.tokensPerConversation,
      (v) => num(v, 0),
    ],
    [
      "Custo por conversa (US$)",
      a.summary.costPerConversation,
      b.summary.costPerConversation,
      (v) => (v === null ? "—" : v.toFixed(3)),
    ],
    ["Avaliadores (%)", hundred(a.summary.graders), hundred(b.summary.graders), (v) => num(v, 0)],
    ["Juiz (%)", hundred(a.summary.judge), hundred(b.summary.judge), (v) => num(v, 0)],
    ["Recall da busca (%)", hundred(a.summary.recall), hundred(b.summary.recall), (v) => num(v, 0)],
  ];
  return [
    `# ${a.label} → ${b.label}`,
    "",
    "| Métrica | Antes | Depois | Diferença |",
    "|---|---|---|---|",
    ...rows.map(([name, x, y, f]) => {
      const d = x !== null && y !== null ? y - x : null;
      const sign = d !== null && d > 0 ? "+" : "";
      return `| ${name} | ${f(x)} | ${f(y)} | ${d === null ? "—" : `${sign}${f(d)}`} |`;
    }),
    "",
  ].join("\n");
}

const ms = (v: number | null) => (v === null ? null : v / 1000);
const hundred = (v: number | null) => (v === null ? null : v * 100);
