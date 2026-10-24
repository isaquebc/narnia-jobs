import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CalibrationItem,
  type CalibrationReport,
  type CalibrationVerdict,
  type JudgeLabel,
  knownFactsText,
  parseCalibrationItems,
  parseEvalCases,
  scoreCalibration,
} from "@narnia-jobs/core";
import {
  type CompleteInput,
  type CompleteResult,
  createProviderFromEnv,
} from "@narnia-jobs/providers";
import { savedPostingsText } from "./cli-evals";
import { chatJudge } from "./judges";
import { judgeLocally } from "./local-eval";
import { judgePair } from "./pairwise";
import { judgeContext } from "./run";
import { openEvalSandbox } from "./sandbox";

/**
 * Calibração dos juízes (pedido do dono, 2026-10-24): roda o juiz do recrutador e o pairwise do gate sobre respostas
 * rotuladas à mão (`evals/calibration/*.jsonl`) e conta falsos positivos e negativos. O contexto é o mesmo da rodada
 * do chat (persona e cartões da fixture do sandbox, mais os fatos conhecidos).
 */
type Completer = { complete(input: CompleteInput): Promise<CompleteResult> };

const repoRoot = () => fileURLToPath(new URL("../../../../", import.meta.url));
const PARALLEL = 4;

export async function calibrateJudges(
  items: CalibrationItem[],
  o: {
    provider: Completer;
    context: string;
    messagesOf: (caseId: string) => string[] | null;
    /** Marcadores das respostas (`{{profileId}}`): os ids mudam a cada sandbox. */
    vars?: Record<string, string>;
  },
): Promise<{ report: CalibrationReport; explanations: Record<string, string> }> {
  const missing = [...new Set(items.map((x) => x.case))].filter((c) => !o.messagesOf(c));
  if (missing.length > 0)
    throw new Error(`Casos do chat que não existem em evals/chat: ${missing.join(", ")}`);
  const judge = chatJudge();
  const explanations: Record<string, string> = {};
  const fill = (a: { replies: string[]; tools: string[] }) => ({
    tools: a.tools,
    replies: a.replies.map((r) => r.replace(/\{\{(\w+)\}\}/g, (m, k: string) => o.vars?.[k] ?? m)),
  });
  const run = async (x: CalibrationItem): Promise<CalibrationVerdict> => {
    const input = { messages: o.messagesOf(x.case), context: o.context };
    if (x.kind === "absolute") {
      const j = await judgeLocally(o.provider, judge, {
        input,
        output: fill(x),
      });
      explanations[x.id] = j.explanation;
      return {
        id: x.id,
        kind: "absolute",
        defect: x.defect,
        expect: x.expect,
        got: j.label as JudgeLabel,
      };
    }
    // a pior no lugar da aprovada: a 1ª ordem tem a pior em A e a melhor em B
    const p = await judgePair(
      o.provider,
      judge,
      { input },
      { approved: fill(x.worse), candidate: fill(x.better) },
    );
    explanations[x.id] = p.explanation;
    return { id: x.id, kind: "pair", defect: x.defect, first: p.picks[0], swapped: p.picks[1] };
  };
  const verdicts: CalibrationVerdict[] = [];
  for (let i = 0; i < items.length; i += PARALLEL)
    verdicts.push(...(await Promise.all(items.slice(i, i + PARALLEL).map(run))));
  return { report: scoreCalibration(verdicts), explanations };
}

const pct = (n: number, total: number) => (total ? `${Math.round((100 * n) / total)}%` : "—");

/** `narnia-jobs evals calibration [ids…] [--strict]`: mock = smoke; real com `NARNIA_PROVIDER=claude-code`. */
export async function runCalibration(args: string[]): Promise<number> {
  const strict = args.includes("--strict");
  const only = args.filter((a) => !a.startsWith("--"));
  const root = repoRoot();
  const read = (dir: string, ext: string) =>
    readdirSync(join(root, dir))
      .filter((f) => f.endsWith(ext))
      .map((f) => readFileSync(join(root, dir, f), "utf8"));
  const items = read("evals/calibration", ".jsonl")
    .flatMap(parseCalibrationItems)
    .filter((x) => only.length === 0 || only.includes(x.id));
  const cases = read("evals/chat", ".jsonl").flatMap(parseEvalCases);
  const provider = createProviderFromEnv();
  const sandbox = await openEvalSandbox({ provider });
  try {
    const card = await fetch(`${sandbox.baseUrl}/api/profiles/active/persona-card`, {
      headers: { authorization: `Bearer ${sandbox.token}` },
    })
      .then((r) => r.json() as Promise<{ text: string }>)
      .then((c) => c.text)
      .catch(() => "");
    const { report: r, explanations } = await calibrateJudges(items, {
      provider,
      context: judgeContext(card, knownFactsText(sandbox.repos), savedPostingsText(sandbox.repos)),
      messagesOf: (id) => cases.find((c) => c.id === id)?.messages ?? null,
      vars: { profileId: sandbox.repos.profiles.active()?.id ?? "" },
    });
    const a = r.absolute;
    const p = r.pairs;
    console.log(
      `Juiz do recrutador (padrao_de_entrega): ${a.right}/${a.total} certos (${pct(a.right, a.total)})`,
    );
    console.log(`  falsos positivos (mais brando que o rótulo): ${a.falsePositives}`);
    console.log(`  falsos negativos (mais duro que o rótulo): ${a.falseNegatives}`);
    console.log(`Pairwise: ${p.right}/${p.total} certos (${pct(p.right, p.total)})`);
    console.log(
      `  preferiu a pior: ${p.wrong} · viés de posição: ${p.positionBias} · empate: ${p.ties}`,
    );
    console.log("Por defeito:");
    for (const [d, v] of Object.entries(r.byDefect))
      console.log(`  ${v.right === v.total ? "✔" : "✘"} ${d}: ${v.right}/${v.total}`);
    if (r.mistakes.length > 0) console.log("Erros:");
    for (const m of r.mistakes)
      console.log(
        `  ${m.severe ? "‼" : "!"} ${m.id} · ${m.kind} · ${m.detail}\n      ${explanations[m.id] ?? ""}`,
      );
    return strict && r.mistakes.length > 0 ? 1 : 0;
  } finally {
    await sandbox.close();
  }
}
