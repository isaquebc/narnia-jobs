import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initTelemetry, parseEvalCases, shutdownTelemetry } from "@narnia-jobs/core";
import { createProviderFromEnv, type Provider, STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { contentTracingEnabled } from "@narnia-jobs/shared";
import { syncChatJudge, syncEvaluators } from "./eval-sync";
import { chatJudge, judgeFor } from "./judges";
import { judgeLocally, type LocalEvaluation, recordLocalExperiment } from "./local-eval";
import { recordPhoenixExperiment } from "./phoenix";
import { createPhoenixAdmin, phoenixBaseUrl } from "./phoenix-admin";
import { datasetRows, PROMPT_DATASETS } from "./prompt-datasets";
import { promptEvaluators } from "./prompt-evaluators";
import { runEvalCases } from "./run";
import { openEvalSandbox } from "./sandbox";

/**
 * Avaliações que não rodam no Playground (M5), sempre num banco temporário isolado (decisão AV-3 revista):
 * - `evals chat`: conversas de referência (`evals/chat/*.jsonl`) com o recrutador, pelas ferramentas reais do sandbox;
 *   regras sem tokens + juiz do recrutador; experimento no dataset `narnia-chat`; rastros no projeto `narnia-evals`;
 * - `evals pdf`: leitura do PDF fictício (`evals/fixtures/cv_text.pdf`) com a tool Read; avaliadores e juiz do dataset
 *   `narnia-read-document`.
 * Os dados do usuário nunca entram: o sandbox é apagado no fim.
 */
const repoRoot = () => fileURLToPath(new URL("../../../../", import.meta.url));
const EXP_NAME = (kind: string) =>
  `${kind} ${process.env.NARNIA_PROVIDER ?? "claude-code"} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

interface Ctx {
  provider: Provider;
  phoenix: string | null;
  customProviderId: string | null;
}

async function context(): Promise<Ctx> {
  const phoenix = phoenixBaseUrl(process.env);
  const status = phoenix ? await createPhoenixAdmin({ baseUrl: phoenix }).status() : null;
  if (phoenix && !status?.reachable)
    console.log(`O Phoenix não respondeu em ${phoenix}: os resultados ficam só aqui.`);
  return {
    provider: createProviderFromEnv(),
    phoenix: status?.reachable ? phoenix : null,
    customProviderId: status?.providerId ?? null,
  };
}

const mark = (score: number) => (score >= 1 ? "✔" : score >= 0.5 ? "~" : "✘");

async function chat(ctx: Ctx, only: string[]): Promise<number> {
  const dir = join(repoRoot(), "evals/chat");
  const cases = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => parseEvalCases(readFileSync(join(dir, f), "utf8")))
    .filter((c) => only.length === 0 || only.includes(c.id));
  const sandbox = await openEvalSandbox({ provider: ctx.provider });
  let failed = 0;
  try {
    console.log(
      `Sandbox isolado em ${sandbox.baseUrl} (banco descartável com a fixture fictícia).`,
    );
    const report = await runEvalCases(cases, { baseUrl: sandbox.baseUrl, token: sandbox.token });
    const judge = chatJudge();
    for (const r of report) {
      const c = cases.find((x) => x.id === r.id);
      if (r.error || !c) continue;
      try {
        r.judges = [
          await judgeLocally(ctx.provider, judge, {
            input: { messages: c.messages },
            output: { replies: r.replies, tools: r.tools },
          }),
        ];
      } catch (e) {
        console.log(`  ! juiz de ${r.id}: ${(e as Error).message}`);
      }
    }
    for (const r of report) {
      console.log(`${r.passed ? "✔" : "✘"} ${r.id}${r.error ? ` · erro: ${r.error}` : ""}`);
      for (const g of r.results) console.log(`    ${g.passed ? "✔" : "✘"} ${g.type}: ${g.detail}`);
      for (const j of r.judges ?? [])
        console.log(`    ${mark(j.score)} ${j.name} (${j.label}): ${j.explanation}`);
      if (!r.passed || (r.judges ?? []).some((j) => j.score < 1)) failed++;
    }
    if (ctx.phoenix && report.length > 0) {
      const exp = await recordPhoenixExperiment(cases, report, {
        baseUrl: ctx.phoenix,
        name: EXP_NAME("chat"),
        content: contentTracingEnabled(),
      });
      await syncChatJudge({ baseUrl: ctx.phoenix, customProviderId: ctx.customProviderId });
      console.log(
        `Phoenix: experimento ${exp.experimentId} no dataset narnia-chat (${exp.runs} execuções)`,
      );
    }
    console.log(`${report.length - failed}/${report.length} conversas sem ressalvas`);
  } finally {
    await sandbox.close();
  }
  return failed;
}

async function pdf(ctx: Ctx): Promise<number> {
  const sandbox = await openEvalSandbox({ provider: ctx.provider });
  let failed = 0;
  try {
    const uploads = join(sandbox.dir, "uploads");
    mkdirSync(uploads, { recursive: true });
    const [example] = PROMPT_DATASETS.readDocument;
    const [row] = datasetRows("readDocument");
    if (!example || !row) return 0;
    const filePath = join(uploads, "cv_text.pdf");
    copyFileSync(join(repoRoot(), "evals/fixtures/cv_text.pdf"), filePath);
    const startedAt = new Date().toISOString();
    let output: unknown = null;
    let error: string | undefined;
    try {
      output = (
        await ctx.provider.readDocument({
          filePath,
          locale: example.input.locale,
          model: STRUCTURED_PROMPTS.readDocument.defaultModel,
        })
      ).output;
    } catch (e) {
      error = (e as Error).message;
    }
    const endedAt = new Date().toISOString();
    const evaluations: LocalEvaluation[] = [];
    if (!error) {
      const evalCtx = {
        input: row.input,
        output: { messages: [{ role: "assistant", content: JSON.stringify(output) }] },
        reference: example.reference,
        metadata: row.metadata,
      };
      for (const e of promptEvaluators("readDocument"))
        evaluations.push({ name: e.name, kind: "CODE", ...e.run(evalCtx) });
      evaluations.push({
        kind: "LLM",
        ...(await judgeLocally(ctx.provider, judgeFor("readDocument"), evalCtx)),
      });
    }
    console.log(
      `${error ? "✘" : "✔"} leitura do PDF (${example.id})${error ? ` · erro: ${error}` : ""}`,
    );
    for (const ev of evaluations) {
      console.log(`    ${mark(ev.score)} ${ev.name}: ${ev.explanation}`);
      if (ev.score < 1) failed++;
    }
    if (error) failed++;
    if (ctx.phoenix) {
      await syncEvaluators({ baseUrl: ctx.phoenix, customProviderId: ctx.customProviderId });
      const exp = await recordLocalExperiment(
        {
          dataset: STRUCTURED_PROMPTS.readDocument.name,
          name: EXP_NAME("leitura do PDF"),
          runs: [
            {
              exampleId: example.id,
              output,
              startedAt,
              endedAt,
              ...(error ? { error } : {}),
              evaluations,
            },
          ],
        },
        { baseUrl: ctx.phoenix },
      );
      console.log(
        `Phoenix: experimento ${exp.experimentId} no dataset ${STRUCTURED_PROMPTS.readDocument.name}`,
      );
    }
  } finally {
    await sandbox.close();
  }
  return failed;
}

/** `narnia-jobs evals chat|pdf [ids…] [--strict]`. */
export async function runSandboxEvals(kind: "chat" | "pdf", args: string[]): Promise<number> {
  const strict = args.includes("--strict");
  const only = args.filter((a) => !a.startsWith("--"));
  await initTelemetry({ ...process.env, NARNIA_OTEL_PROJECT: "narnia-evals" }, "narnia-evals");
  try {
    const ctx = await context();
    const failed = kind === "chat" ? await chat(ctx, only) : await pdf(ctx);
    return strict && failed > 0 ? 1 : 0;
  } finally {
    await shutdownTelemetry();
  }
}
