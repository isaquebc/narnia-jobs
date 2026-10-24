import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initTelemetry,
  inspectPdf,
  knownFactsText,
  parseEvalCases,
  type Repos,
  renderDocumentHtml,
  renderPdf,
  renderPdfPages,
  shutdownTelemetry,
} from "@narnia-jobs/core";
import { createProviderFromEnv, type Provider, STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { type CvContent, contentTracingEnabled } from "@narnia-jobs/shared";
import { BaselineGate, gateFlags, type PairRun } from "./baseline-file";
import { syncChatJudge, syncEvaluators } from "./eval-sync";
import { chatJudge, judgeFor } from "./judges";
import { judgeLocally, type LocalEvaluation, recordLocalExperiment } from "./local-eval";
import { PAIRWISE_NAME } from "./pairwise";
import { recordPhoenixExperiment } from "./phoenix";
import { createPhoenixAdmin, phoenixBaseUrl } from "./phoenix-admin";
import { gitCommit } from "./phoenix-setup";
import { promptCatalog } from "./prompt-catalog";
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
 * - `evals cv-review`: revisor do CV (F05-13) com as imagens reais das páginas: o CV do exemplo vira PDF no serviço
 *   `browser` (um exemplo com o cabeçalho sobreposto de propósito) e o revisor lê os PNGs com a tool Read.
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

/** Vagas salvas no sandbox, para os avaliadores e o juiz (F12/M5: a conversa do formulário cita a empresa). */
export const savedPostingsText = (repos: Repos) =>
  repos.postings
    .list()
    .map((p) => [p.company, p.client, p.title].filter(Boolean).join(" · "))
    .join("\n");

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

/** Chave da versão aprovada das conversas (AV-6) e versão: hash de tudo o que o recrutador usa. */
const CHAT_KEY = "narnia-chat";
const chatVersion = () =>
  createHash("sha256")
    .update(
      promptCatalog()
        .filter((p) => p.kind !== "structured")
        .map((p) => `${p.name}:${p.hash}`)
        .join("\n"),
    )
    .digest("hex");

const mark = (score: number) => (score >= 1 ? "✔" : score >= 0.5 ? "~" : "✘");

async function chat(ctx: Ctx, only: string[], gate?: BaselineGate): Promise<number> {
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
    const report = await runEvalCases(cases, {
      baseUrl: sandbox.baseUrl,
      token: sandbox.token,
      knownFacts: knownFactsText(sandbox.repos),
      newApplication: () => sandbox.newApplication(),
      savedPostings: savedPostingsText(sandbox.repos),
    });
    const judge = chatJudge();
    for (const r of report) {
      const c = cases.find((x) => x.id === r.id);
      if (r.error || !c) continue;
      try {
        r.judges = [
          await judgeLocally(ctx.provider, judge, {
            input: { messages: c.messages, context: r.context ?? "" },
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
      // por caso só para consulta: uma amostra por caso oscila (um avaliador a mais ou a menos = 17–20 pontos)
      gate?.record(
        `chat:${r.id}`,
        {
          graders: r.results.length
            ? r.results.filter((g) => g.passed).length / r.results.length
            : r.passed
              ? 1
              : 0,
        },
        { gate: false },
      );
    }
    // o bloqueio é pela média da rodada inteira (todos os avaliadores de todos os casos, e o juiz), só na rodada completa
    const graded = report.flatMap((r) => r.results);
    const judged = report.flatMap((r) => r.judges ?? []);
    // caso com erro (do modelo ou do preparo) deixa a rodada incompleta: não vira linha de base nem aprovada
    if (gate && graded.length > 0 && only.length === 0)
      gate.record(
        "chat:avaliadores",
        { media: graded.filter((g) => g.passed).length / graded.length },
        { errors: report.filter((r) => r.error).length },
      );
    if (gate && judged.length > 0 && only.length === 0)
      gate.record("chat:juiz", {
        media: judged.reduce((sum, j) => sum + j.score, 0) / judged.length,
      });
    // M7: a conversa depende do recrutador, do especializado, das notas e das skills; qualquer um mudou = versão nova
    if (gate && only.length === 0) {
      const cmp = await gate.pairwise(CHAT_KEY, {
        versionId: chatVersion(),
        commit: gitCommit(),
        judge,
        provider: ctx.provider,
        runs: report.flatMap((r): PairRun[] => {
          const c = cases.find((x) => x.id === r.id);
          if (!c) return [];
          return [
            {
              exampleId: r.id,
              ctx: { input: { messages: c.messages, context: r.context ?? "" } },
              output: { replies: r.replies, tools: r.tools },
              evaluations: [
                ...r.results.map((g) => ({
                  name: g.type,
                  kind: "CODE" as const,
                  label: g.passed ? "passou" : "falhou",
                  score: g.passed ? 1 : 0,
                  explanation: g.detail,
                })),
                ...(r.judges ?? []).map((j) => ({ ...j, kind: "LLM" as const })),
              ],
              error: r.error,
            },
          ];
        }),
      });
      // no experimento do Phoenix, o resultado do pairwise de cada conversa vai junto dos juízes
      for (const x of cmp.cases) {
        const r = report.find((y) => y.id === x.exampleId);
        r?.judges?.push({
          name: PAIRWISE_NAME,
          label: x.outcome,
          score: x.outcome === "ganhou" ? 1 : x.outcome === "empate" ? 0.5 : 0,
          explanation: x.explanation,
        });
      }
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

/** Cabeçalho sobreposto de propósito: defeito que só a imagem mostra (o texto extraído continua igual). */
const BREAK_LAYOUT = "<style>.title{margin-top:-20pt}.contact{margin-top:-16pt}</style></head>";

async function cvReview(ctx: Ctx, gate?: BaselineGate): Promise<number> {
  const ws = process.env.NARNIA_BROWSER_WS;
  if (!ws) {
    console.log("✘ evals cv-review precisa do serviço browser (NARNIA_BROWSER_WS).");
    return 1;
  }
  const examples = PROMPT_DATASETS.cvReview;
  const rows = datasetRows("cvReview");
  const model = STRUCTURED_PROMPTS.cvReview.defaultModel;
  const scores = new Map<string, number[]>();
  let failed = 0;
  let errors = 0;
  const runs: Parameters<typeof recordLocalExperiment>[0]["runs"] = [];
  const pairRuns: PairRun[] = [];
  for (const [i, example] of examples.entries()) {
    const dir = mkdtempSync(join(tmpdir(), "narnia-cv-review-"));
    const startedAt = new Date().toISOString();
    let output: unknown = null;
    let error: string | undefined;
    let pdfText = "";
    try {
      let html = renderDocumentHtml(example.input.content as CvContent, "classico");
      if ((example.reference as { breakLayout?: boolean }).breakLayout)
        html = html.replace("</head>", BREAK_LAYOUT);
      const r = await renderPdf(ws, html, { paper: "A4" });
      if (!r.ok) throw new Error(r.message);
      writeFileSync(join(dir, "cv.pdf"), r.pdf);
      mkdirSync(join(dir, "pages"));
      const pages = await renderPdfPages(join(dir, "cv.pdf"), join(dir, "pages"), { dpi: 110 });
      pdfText = (await inspectPdf(r.pdf)).text;
      output = (
        await ctx.provider.cvReview({
          ...example.input,
          dir,
          pageFiles: pages.map((p) => relative(dir, p)),
          pdfText,
          model,
        })
      ).output;
    } catch (e) {
      error = (e as Error).message;
      errors++;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const endedAt = new Date().toISOString();
    const evaluations: LocalEvaluation[] = [];
    const row = rows[i];
    if (!error && row) {
      const evalCtx = {
        input: { ...row.input, pdf_text: pdfText },
        output: { messages: [{ role: "assistant", content: JSON.stringify(output) }] },
        reference: example.reference,
        metadata: row.metadata,
      };
      for (const e of promptEvaluators("cvReview"))
        evaluations.push({ name: e.name, kind: "CODE", ...e.run(evalCtx) });
      evaluations.push({
        kind: "LLM",
        ...(await judgeLocally(ctx.provider, judgeFor("cvReview"), evalCtx)),
      });
    }
    console.log(
      `${error ? "✘" : "✔"} revisão do CV (${example.id})${error ? ` · erro: ${error}` : ""}`,
    );
    for (const ev of evaluations) {
      console.log(`    ${mark(ev.score)} ${ev.name}: ${ev.explanation}`);
      if (ev.score < 1) failed++;
      scores.set(ev.name, [...(scores.get(ev.name) ?? []), ev.score]);
    }
    if (error) failed++;
    runs.push({
      exampleId: example.id,
      output,
      startedAt,
      endedAt,
      ...(error ? { error } : {}),
      evaluations,
    });
    pairRuns.push({
      exampleId: example.id,
      ctx: {
        input: { ...row?.input, pdf_text: pdfText },
        reference: example.reference,
        metadata: row?.metadata,
      },
      output: { messages: [{ role: "assistant", content: JSON.stringify(output) }] },
      evaluations,
      error,
    });
  }
  gate?.record(
    STRUCTURED_PROMPTS.cvReview.name,
    Object.fromEntries([...scores].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])),
    { errors },
  );
  const version = promptCatalog().find((p) => p.name === STRUCTURED_PROMPTS.cvReview.name)?.hash;
  if (gate && version) {
    const cmp = await gate.pairwise(STRUCTURED_PROMPTS.cvReview.name, {
      versionId: version,
      commit: gitCommit(),
      judge: judgeFor("cvReview"),
      provider: ctx.provider,
      runs: pairRuns,
    });
    for (const x of cmp.cases)
      runs
        .find((r) => r.exampleId === x.exampleId)
        ?.evaluations.push({
          name: PAIRWISE_NAME,
          kind: "LLM",
          label: x.outcome,
          score: x.outcome === "ganhou" ? 1 : x.outcome === "empate" ? 0.5 : 0,
          explanation: x.explanation,
        });
  }
  if (ctx.phoenix) {
    await syncEvaluators({ baseUrl: ctx.phoenix, customProviderId: ctx.customProviderId });
    const exp = await recordLocalExperiment(
      { dataset: STRUCTURED_PROMPTS.cvReview.name, name: EXP_NAME("revisão do CV"), runs },
      { baseUrl: ctx.phoenix },
    );
    console.log(
      `Phoenix: experimento ${exp.experimentId} no dataset ${STRUCTURED_PROMPTS.cvReview.name}`,
    );
  }
  return failed;
}

/**
 * `narnia-jobs evals chat|pdf [ids…] [--strict] [--gate] [--update-baseline]`. No chat, `--gate` compara cada caso com
 * a linha de base de `evals/baselines.json` (F06-14: a persona do recrutador é um prompt como os outros).
 */
export async function runSandboxEvals(
  kind: "chat" | "pdf" | "cv-review",
  args: string[],
): Promise<number> {
  const strict = args.includes("--strict");
  const gate = new BaselineGate(gateFlags(args));
  const only = args.filter((a) => !a.startsWith("--"));
  await initTelemetry({ ...process.env, NARNIA_OTEL_PROJECT: "narnia-evals" }, "narnia-evals");
  try {
    const ctx = await context();
    const failed =
      kind === "chat"
        ? await chat(ctx, only, gate)
        : kind === "pdf"
          ? await pdf(ctx)
          : await cvReview(ctx, gate);
    const regressed = gate.finish();
    return (strict && failed > 0) || regressed ? 1 : 0;
  } finally {
    await shutdownTelemetry();
  }
}
