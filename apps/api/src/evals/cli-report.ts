import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChatTools,
  createRepos,
  factSearchRecall,
  migrate,
  openDatabase,
  parseRecallCases,
  type RecallReport,
  seedFixture,
} from "@narnia-jobs/core";
import { gitCommit } from "./phoenix-setup";
import { buildRunReport, compareRunReports, type RunReportJson } from "./report";
import type { EvalCaseReport } from "./run";

/**
 * Relatórios da rodada (F04-fix-fundamentacao, FF-3): `evals chat --report=<rótulo>` grava latência, uso, tools, buscas,
 * notas e o recall da busca em `evals/reports/<data>-<rótulo>.{md,json}`; `evals search` mede só o recall (sem modelo);
 * `evals compare <a> <b>` compara duas rodadas.
 */
const repoRoot = () => fileURLToPath(new URL("../../../../", import.meta.url));
const reportsDir = () => join(repoRoot(), "evals/reports");

/** Recall da `fact_search` real sobre a fixture fictícia, num banco em memória. */
export async function searchRecallNow(): Promise<RecallReport> {
  const db = openDatabase(":memory:");
  try {
    migrate(db);
    const repos = createRepos(db);
    seedFixture(repos, "engineer");
    const tools = createChatTools(repos, { ingest: {} as never });
    const cases = parseRecallCases(
      readFileSync(join(repoRoot(), "evals/search/recall.jsonl"), "utf8"),
    );
    return await factSearchRecall(cases, async (q) => (await tools["fact.search"]({ q })).items);
  } finally {
    db.close();
  }
}

export function writeRunReport(o: {
  label: string;
  samples: EvalCaseReport[][];
  recall?: RecallReport;
}): string {
  const at = new Date().toISOString();
  const { json, markdown } = buildRunReport({
    label: o.label,
    commit: gitCommit(),
    at,
    provider: process.env.NARNIA_PROVIDER ?? "mock",
    samples: o.samples,
    ...(o.recall ? { recall: o.recall } : {}),
  });
  mkdirSync(reportsDir(), { recursive: true });
  const base = join(reportsDir(), `${at.slice(0, 10)}-${o.label.replace(/[^\w.-]+/g, "_")}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 1)}\n`);
  writeFileSync(`${base}.md`, markdown);
  console.log(`\n${markdown}\nRelatório gravado em ${base}.md (e .json).`);
  return `${base}.json`;
}

export const reportFlag = (args: string[]) =>
  args.find((a) => a.startsWith("--report="))?.slice("--report=".length) || undefined;

export async function runSearchEvals(args: string[]): Promise<number> {
  const recall = await searchRecallNow();
  const label = reportFlag(args);
  if (label) writeRunReport({ label, samples: [], recall });
  else {
    console.log(`Recall da busca de fatos: ${Math.round(recall.overall * 100)}%`);
    for (const [cat, v] of Object.entries(recall.byCategory))
      console.log(`  ${cat}: ${Math.round((v ?? 0) * 100)}%`);
    for (const c of recall.cases.filter((x) => x.missing.length))
      console.log(`  ✘ ${c.id}: ${c.missing.join("; ")}`);
  }
  return 0;
}

export function runCompare(args: string[]): number {
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length !== 2) {
    console.log("narnia-jobs evals compare <antes.json> <depois.json> (em evals/reports)");
    return 2;
  }
  const read = (f: string): RunReportJson => {
    const path = isAbsolute(f) || existsSync(f) ? f : join(reportsDir(), f);
    return JSON.parse(readFileSync(path, "utf8")) as RunReportJson;
  };
  console.log(compareRunReports(read(files[0] as string), read(files[1] as string)));
  return 0;
}
