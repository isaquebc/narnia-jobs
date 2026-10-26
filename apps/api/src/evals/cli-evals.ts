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
  depsChanged,
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
import { approvedPlugins } from "./approved-plugin";
import { BaselineGate, gateFlags, type PairRun, readApproved } from "./baseline-file";
import { chatCaseDeps } from "./chat-deps";
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
import { type EvalCaseReport, runEvalCases } from "./run";
import { openEvalSandbox, withEvalSandbox } from "./sandbox";

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

/**
 * Vagas salvas no sandbox, para os avaliadores e o juiz (F12/M5: a conversa do formulário cita a empresa), com a
 * descrição que o `posting_get` devolve (2026-10-26: sem ela, o juiz punia como invenção citar o que a vaga pede).
 * Descrição longa é cortada para o contexto do juiz não crescer sem limite.
 */
const JD_LIMIT = 1200;
export const savedPostingsText = (repos: Repos) =>
  repos.postings
    .list()
    .map((p) => {
      const head = [p.company, p.client, p.title].filter(Boolean).join(" · ");
      const jd = (p.jdText ?? "").trim();
      if (!jd) return head;
      return `${head}\nDescrição: ${jd.length > JD_LIMIT ? `${jd.slice(0, JD_LIMIT)}…` : jd}`;
    })
    .join("\n\n");

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
  let failed = 0;
  {
    // cada rodada (a principal e cada amostra extra, dos dois lados) num sandbox novo: o estado de uma não vaza para a
    // seguinte (2026-10-26)
    const runCases = (list: typeof cases) =>
      withEvalSandbox({ provider: ctx.provider }, (sandbox) => {
        console.log(
          `Sandbox isolado em ${sandbox.baseUrl} (banco descartável com a fixture fictícia).`,
        );
        return runEvalCases(list, {
          baseUrl: sandbox.baseUrl,
          token: sandbox.token,
          knownFacts: knownFactsText(sandbox.repos),
          newApplication: (opts) => sandbox.newApplication(opts),
          readyPostingCv: () => sandbox.readyPostingCv(),
          savedPostings: savedPostingsText(sandbox.repos),
        });
      });
    const judge = chatJudge();
    const judgeAll = async (list: EvalCaseReport[]) => {
      for (const r of list) {
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
    };
    const report = await runCases(cases);
    await judgeAll(report);
    for (const r of report) {
      console.log(`${r.passed ? "✔" : "✘"} ${r.id}${r.error ? ` · erro: ${r.error}` : ""}`);
      for (const g of r.results) console.log(`    ${g.passed ? "✔" : "✘"} ${g.type}: ${g.detail}`);
      for (const j of r.judges ?? [])
        console.log(`    ${mark(j.score)} ${j.name} (${j.label}): ${j.explanation}`);
      if (!r.passed || (r.judges ?? []).some((j) => j.score < 1)) failed++;
    }

    // gate robusto (2026-10-25): dependências por caso (o pairwise só compara o caso que mudou) e amostras extras
    const flags = gate?.flags;
    const full = only.length === 0;
    const catalog = promptCatalog().filter((p) => p.kind !== "structured");
    const approved = new Map(readApproved(CHAT_KEY).map((a) => [a.exampleId, a]));
    const depsOf = (r: EvalCaseReport) => {
      const c = cases.find((x) => x.id === r.id);
      const before = approved.get(r.id)?.output as { tools?: string[] } | undefined;
      return c ? chatCaseDeps(c, [...r.tools, ...(before?.tools ?? [])], catalog) : {};
    };
    const unchanged = (r: EvalCaseReport) => {
      const a = approved.get(r.id);
      return Boolean(a?.deps) && !depsChanged(a?.deps, depsOf(r));
    };
    const comparing = Boolean(flags && (flags.gate || flags.update));
    // gate: 5 amostras nos casos afetados (o placar soma as amostras, 2026-10-26); A contra A: 3 (a taxa por amostra não
    // depende de N)
    const sampleCount = flags?.samples ?? (flags?.noise ? 3 : comparing ? 5 : 1);
    // A contra A: os casos sem mudança; gate: os que mudaram e têm aprovada (os outros não entram no placar)
    const featureIds = flags?.feature ?? [];
    const extraIds = report
      .filter((r) => !r.error && approved.has(r.id) && full)
      .filter((r) => (flags?.noise ? unchanged(r) : comparing && !unchanged(r)))
      .map((r) => r.id);
    // --feature: os casos novos (sem aprovada) também ganham as amostras; o lado A não existe para eles
    const featureRuns =
      comparing && !flags?.noise && full ? featureIds.filter((id) => !approved.has(id)) : [];

    const sample = async (
      label: string,
      ids: string[],
      into: Map<string, EvalCaseReport[]>,
      judgeThem: boolean,
    ) => {
      console.log(`\n${label}: ${ids.join(", ")}`);
      const more = await runCases(cases.filter((c) => ids.includes(c.id)));
      if (judgeThem) await judgeAll(more);
      for (const r of more) {
        into.set(r.id, [...(into.get(r.id) ?? []), r]);
        const j = r.judges?.[0];
        console.log(
          `  ${r.passed ? "✔" : "✘"} ${r.id}${r.error ? ` · erro: ${r.error}` : ""}${j ? ` · ${mark(j.score)} juiz (${j.label})` : ""}`,
        ); // o que falhou na amostra (sem isso, só a primeira amostra mostrava o motivo)
        for (const g of r.results.filter((x) => !x.passed))
          console.log(`      ✘ ${g.type}: ${g.detail}`);
        if (j && j.score < 1) console.log(`      ${mark(j.score)} ${j.name}: ${j.explanation}`);
      }
    };
    const extras = new Map<string, EvalCaseReport[]>();
    for (let k = 2; k <= sampleCount && extraIds.length > 0; k++)
      await sample(`Amostra ${k} de ${sampleCount}`, extraIds, extras, true);
    for (let k = 2; k <= sampleCount && featureRuns.length > 0; k++)
      await sample(`Caso novo, amostra ${k} de ${sampleCount}`, featureRuns, extras, true);
    // lado A com amostras novas (a saída guardada venceu o gate anterior: está acima da média e ganhava 7 de 7 casos
    // decididos no A contra A). No A contra A, a mesma versão de novo; no gate, os prompts do commit da aprovada
    const against = new Map<string, EvalCaseReport[]>();
    const plugins: Array<{ commit: string; dir: string }> = [];
    try {
      if (flags?.noise && extraIds.length > 0)
        for (let k = 1; k <= sampleCount; k++)
          await sample(`Lado A, amostra ${k} de ${sampleCount}`, extraIds, against, false);
      if (comparing && !flags?.noise && extraIds.length > 0) {
        plugins.push(...approvedPlugins(repoRoot(), CHAT_KEY));
        const byPlugin = new Map<string, string[]>();
        for (const id of extraIds) {
          const a = approved.get(id);
          const c = cases.find((x) => x.id === id);
          const tools = (a?.output as { tools?: string[] } | undefined)?.tools ?? [];
          const found = plugins.find(
            (p) =>
              a?.deps &&
              c &&
              !depsChanged(
                a.deps,
                chatCaseDeps(
                  c,
                  tools,
                  promptCatalog(p.dir).filter((x) => x.kind !== "structured"),
                ),
              ),
          );
          if (found) byPlugin.set(found.dir, [...(byPlugin.get(found.dir) ?? []), id]);
          else
            console.log(
              `  ! ${id}: nenhum commit reproduz a versão aprovada; o lado A é a saída guardada.`,
            );
        }
        for (const [dir, ids] of byPlugin) {
          const commit = plugins.find((p) => p.dir === dir)?.commit;
          for (let k = 1; k <= sampleCount; k++)
            await withPluginDir(dir, () =>
              sample(
                `Versão aprovada (${commit}), amostra ${k} de ${sampleCount}`,
                ids,
                against,
                false,
              ),
            );
        }
      }
    } finally {
      for (const p of plugins) rmSync(p.dir, { recursive: true, force: true });
    }
    const samplesOf = (r: EvalCaseReport) => [r, ...(extras.get(r.id) ?? [])];
    const errors = report.reduce(
      (n, r) => n + [...samplesOf(r), ...(against.get(r.id) ?? [])].filter((x) => x.error).length,
      0,
    );

    for (const r of report) {
      // por caso só para consulta: uma amostra por caso oscila (um avaliador a mais ou a menos = 17–20 pontos)
      const all = samplesOf(r).flatMap((x) => x.results);
      gate?.record(
        `chat:${r.id}`,
        {
          graders: all.length ? all.filter((g) => g.passed).length / all.length : r.passed ? 1 : 0,
        },
        { gate: false },
      );
    }
    // o bloqueio é pela média da rodada inteira (todos os avaliadores de todos os casos, e o juiz), só na rodada
    // completa; com amostras extras, cada caso pesa o mesmo (a média das amostras dele)
    const means = (pick: (r: EvalCaseReport) => EvalCaseReport[]) => {
      let passed = 0;
      let total = 0;
      let judgeSum = 0;
      let judgeN = 0;
      for (const r of report) {
        const list = pick(r).filter((x) => !x.error);
        if (list.length === 0) continue;
        for (const x of list) {
          passed += x.results.filter((g) => g.passed).length / list.length;
          total += x.results.length / list.length;
        }
        const js = list.flatMap((x) => x.judges ?? []);
        if (js.length > 0) {
          judgeSum += js.reduce((sum, j) => sum + j.score, 0) / js.length;
          judgeN++;
        }
      }
      return {
        avaliadores: total > 0 ? passed / total : null,
        juiz: judgeN > 0 ? judgeSum / judgeN : null,
      };
    };
    const m = means(samplesOf);
    // caso com erro (do modelo ou do preparo) deixa a rodada incompleta: não vira linha de base nem aprovada
    if (gate && m.avaliadores !== null && full)
      gate.record("chat:avaliadores", { media: m.avaliadores }, { errors });
    if (gate && m.juiz !== null && full) gate.record("chat:juiz", { media: m.juiz });

    const pairRun = (r: EvalCaseReport): PairRun[] => {
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
          error: samplesOf(r).find((x) => x.error)?.error,
          deps: depsOf(r),
          samples: (extras.get(r.id) ?? []).map((x) => ({ replies: x.replies, tools: x.tools })),
          ...(against.has(r.id)
            ? {
                against: (against.get(r.id) ?? []).map((x) => ({
                  replies: x.replies,
                  tools: x.tools,
                })),
              }
            : {}),
        },
      ];
    };
    if (gate && flags?.noise) {
      if (!full) console.log("O teste A contra A precisa da rodada inteira (sem ids).");
      else {
        // variação das médias entre as amostras dos casos sem mudança (cada amostra = uma rodada A)
        const sameIds = new Set(extraIds);
        const perSample = Array.from({ length: sampleCount }, (_, k) =>
          means((r) => {
            const x = samplesOf(r)[k];
            return sameIds.has(r.id) && x ? [x] : [];
          }),
        );
        const spread = (key: "avaliadores" | "juiz") => {
          const v = perSample.map((p) => p[key]).filter((x): x is number => x !== null);
          return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0;
        };
        await gate.measureNoise(CHAT_KEY, {
          judge,
          provider: ctx.provider,
          runs: report.filter((r) => sameIds.has(r.id)).flatMap(pairRun),
          errors: [...against.values()].flat().filter((x) => x.error).length,
          spreads: { "chat:avaliadores": spread("avaliadores"), "chat:juiz": spread("juiz") },
        });
      }
    }
    // M7: a conversa depende do recrutador, do especializado, das notas e das skills; o caso só entra no pairwise se
    // alguma das dependências dele mudou
    if (gate && full && !flags?.noise) {
      const cmp = await gate.pairwise(CHAT_KEY, {
        versionId: chatVersion(),
        commit: gitCommit(),
        judge,
        provider: ctx.provider,
        runs: report.flatMap(pairRun),
        // caso novo passa se a maioria das amostras passou em todos os avaliadores e o juiz não reprovou (≥ parcial)
        features: featureIds
          .map((id) => {
            const r = report.find((x) => x.id === id);
            const list = r ? samplesOf(r) : [];
            const ok = list.filter(
              (x) => !x.error && x.passed && (x.judges ?? []).every((j) => j.score >= 0.5),
            ).length;
            return {
              exampleId: id,
              passed: list.length > 0 && ok * 2 > list.length,
              detail: `${ok} de ${list.length} amostras passaram nos avaliadores e no juiz`,
            };
          })
          .filter((f) => report.some((x) => x.id === f.exampleId)),
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
  }
  return failed;
}

/**
 * Roda com outro plugin (o da versão aprovada): a API lê persona, notas e skills de `NARNIA_PLUGIN_DIR` a cada uso,
 * sem cache, e os casos rodam um de cada vez.
 */
async function withPluginDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.NARNIA_PLUGIN_DIR;
  process.env.NARNIA_PLUGIN_DIR = dir;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.NARNIA_PLUGIN_DIR;
    else process.env.NARNIA_PLUGIN_DIR = before;
  }
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
