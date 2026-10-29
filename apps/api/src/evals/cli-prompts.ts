import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProviderFromEnv, STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { BaselineGate, gateFlags, readApproved } from "./baseline-file";
import {
  type Checkpoint,
  checkpointKey,
  isUsageLimit,
  JUDGE_CONCURRENCY,
  limitConcurrency,
  openCheckpoint,
} from "./checkpoint";
import { syncEvaluators } from "./eval-sync";
import { judgeFor } from "./judges";
import { recordPairwiseEvaluations } from "./pairwise";
import { createPhoenixAdmin, phoenixBaseUrl } from "./phoenix-admin";
import {
  approvedPromptVersion,
  mergeRepetitions,
  type PromptExample,
  type PromptExperimentResult,
  runPromptExperiment,
} from "./phoenix-run";
import { gitCommit } from "./phoenix-setup";
import { type PromptDef, promptCatalog } from "./prompt-catalog";
import { datasetRows } from "./prompt-datasets";
import {
  featureResults,
  promptGatePlan,
  promptPairRuns,
  repetitionSpread,
  splitRepetitions,
} from "./prompt-gate";
import { syncPrompts } from "./prompt-sync";

const repoRoot = () => fileURLToPath(new URL("../../../../", import.meta.url));

/** Retomada do gate dos estruturados (2026-10-29): fora do git, apagada quando a rodada grava a linha de base ou o ruído. */
const checkpointPath = () => join(repoRoot(), "evals/.checkpoint/narnia-prompts.json");

/** A chave da retomada: prompts estruturados, datasets, juízes, aprovadas e as opções que mudam as amostras. */
function promptsCheckpoint(targets: PromptDef[], args: string[]): Checkpoint {
  const flags = gateFlags(args);
  const judges = join(repoRoot(), "evals/judges");
  const key = checkpointKey([
    targets.map((d) => `${d.name}:${d.hash}`),
    Object.values(STRUCTURED_PROMPTS).map((s) => datasetRows(s.operation)),
    readdirSync(judges)
      .sort()
      .map((f) => `${f}\n${readFileSync(join(judges, f), "utf8")}`),
    targets.map((d) => readApproved(d.name)),
    flags.noise ?? false,
    flags.samples ?? null,
    flags.feature ?? [],
  ]);
  return openCheckpoint(checkpointPath(), key, { fresh: args.includes("--fresh") });
}

/** Erro do modelo no gate: a rodada para (rodada com erro não grava nada) e o que terminou fica na retomada. */
class PromptRunStopped extends Error {}

/**
 * Avaliações no Phoenix (M5) · `./start.sh evals prompts [nome…] [--strict] [--gate] [--update-baseline]`: sincroniza prompts, datasets e
 * avaliadores e roda cada prompt estruturado sobre o dataset dele como experimento do Phoenix (versão `production`,
 * modelo pela ponte da assinatura, avaliadores rodando no Phoenix). Não grava nada no banco do narnia-jobs além do uso
 * no medidor. Prompts que usam tools (leitura do PDF) ficam de fora: o Playground não executa tools. `--gate` falha
 * quando um avaliador cai abaixo da linha de base de `evals/baselines.json` (F06-14); `--update-baseline` grava as
 * notas desta rodada como a nova linha de base, se não houver regressão. Com `--gate` ou `--update-baseline`, o prompt que
 * mudou é comparado com a versão aprovada (`evals/approved/`, M7): só passa se for upgrade (AV-5); `--fixes=id,…`
 * marca os casos que a mudança corrige. Gate com amostras (2026-10-29), como o do chat: o prompt que mudou roda cada
 * caso `--samples=N` vezes (padrão 5) dos dois lados (a versão aprovada pelo histórico do Phoenix), `--feature=id,…`
 * declara os casos novos (não-inferioridade), `--noise` mede o acaso por prompt (`ruido:<prompt>`) e a rodada retoma
 * de `evals/.checkpoint/narnia-prompts.json`.
 */
export async function runPromptEvals(args: string[]): Promise<number> {
  const strict = args.includes("--strict");
  const gate = new BaselineGate(gateFlags(args));
  const only = args
    .filter((a) => !a.startsWith("--"))
    .map((a) => (a.startsWith("narnia-") ? a : `narnia-${a}`));
  const baseUrl = phoenixBaseUrl(process.env);
  if (!baseUrl) {
    console.log("Phoenix não configurado (NARNIA_OTEL_ENDPOINT ou NARNIA_PHOENIX_URL).");
    return 1;
  }
  const admin = createPhoenixAdmin({ baseUrl });
  const status = await admin.status();
  if (!status.reachable) {
    console.log(`O Phoenix não respondeu em ${baseUrl}.`);
    return 1;
  }
  if (!status.providerRegistered)
    console.log(
      "Ponte não registrada no Phoenix: rodando pelo provedor Anthropic padrão (precisa de chave de API).",
    );
  const commit = gitCommit();
  const catalog = promptCatalog();
  await syncPrompts(catalog, { baseUrl, customProviderId: status.providerId, commit });
  await syncEvaluators({ baseUrl, customProviderId: status.providerId });
  const targets = catalog.filter(
    (p) =>
      p.kind === "structured" &&
      p.tools.length === 0 &&
      (only.length === 0 || only.includes(p.name)),
  );
  let failed = 0;
  const provider = createProviderFromEnv();
  const flags = gate.flags;
  const gating = flags.gate || flags.update || Boolean(flags.noise);
  const cp = gating ? promptsCheckpoint(targets, args) : undefined;
  if (cp && (cp.resumed.values > 0 || cp.resumed.completions > 0))
    console.log(
      `Retomando a rodada anterior (${checkpointPath()}): ${cp.resumed.values} experimento(s) e ${cp.resumed.completions} julgamento(s) já feitos.`,
    );
  // o juiz do pairwise com memória (retomada) e no máximo 4 chamadas ao mesmo tempo (limite de taxa da assinatura)
  const limited = limitConcurrency(provider, JUDGE_CONCURRENCY);
  const judgeProvider = cp ? cp.memo(limited) : limited;
  const printScores = (r: PromptExperimentResult) => {
    for (const e of r.errors) console.log(`  ✘ modelo: ${e}`);
    for (const [name, s] of Object.entries(r.scores)) {
      const mark = s.mean >= 1 ? "✔" : s.mean >= 0.5 ? "~" : "✘";
      console.log(`  ${mark} ${name}: ${(s.mean * 100).toFixed(0)}% (${s.n})`);
      for (const why of s.failed) console.log(`      ${why}`);
    }
    for (const e of r.evaluatorErrors) console.log(`  ! avaliador: ${e}`);
  };
  try {
    for (const def of targets) {
      const op = Object.values(STRUCTURED_PROMPTS).find((s) => s.name === def.name)?.operation;
      const rows = new Map(
        (op ? datasetRows(op) : []).map((row) => [row.metadata.id as string, row]),
      );
      const approved = readApproved(def.name);
      const plan = promptGatePlan({
        flags,
        hash: def.hash,
        approved,
        exampleIds: [...rows.keys()],
      });
      if (plan.mode === "skip") {
        console.log(`\n${def.name} · fora do A contra A (${plan.reason}).`);
        continue;
      }
      // uma repetição por experimento, uma depois da outra (a ponte atende 2 chamadas e enfileira 8); cada uma que
      // termina sem erro fica na retomada, e o erro do modelo no gate para a rodada
      const experiment = async (
        slot: string,
        opts: Partial<Parameters<typeof runPromptExperiment>[1]> = {},
        repetitions = plan.repetitions,
      ) => {
        const results: PromptExperimentResult[] = [];
        for (let k = 1; k <= repetitions; k++) {
          const key = `${def.name}:${slot}:${k}`;
          const saved = cp?.getValue<PromptExperimentResult>(key);
          if (saved) {
            console.log(`  (${def.name} · ${slot} ${k}/${repetitions} vem da retomada)`);
            results.push(saved);
            continue;
          }
          const once = () =>
            runPromptExperiment(def, {
              baseUrl,
              customProviderId: status.providerId,
              commit,
              ...opts,
            });
          // erro passageiro da ponte (500) derrubava horas de rodada: até 2 novas tentativas da repetição; limite de
          // uso não tenta de novo
          let r = await once();
          for (
            let retry = 1;
            retry <= 2 && r.errors.length > 0 && !r.errors.some(isUsageLimit);
            retry++
          ) {
            console.log(
              `  ↻ ${def.name} · ${slot} ${k}: ${r.errors[0]}; nova tentativa ${retry}/2`,
            );
            r = await once();
          }
          results.push(r);
          if (r.errors.length === 0) cp?.putValue(key, r);
          else if (gating) break;
        }
        return mergeRepetitions(results);
      };
      const stopOnError = (r: PromptExperimentResult) => {
        if (gating && r.errors.length > 0)
          throw new PromptRunStopped(`${def.name}: ${r.errors[0] ?? "erro do modelo"}`);
      };
      try {
        if (plan.mode === "noise") {
          const all = await experiment("ruido");
          const n = plan.repetitions / 2;
          console.log(
            `\n${def.name} · A contra A · experimento ${all.experimentId ?? "?"} · ${n} + ${n} repetições`,
          );
          printScores(all);
          stopOnError(all);
          if (!op) continue;
          const { candidate, against } = splitRepetitions(all.examples, n);
          await gate.measureNoise(def.name, {
            judge: judgeFor(op),
            provider: judgeProvider,
            versionId: def.hash,
            runs: promptPairRuns(candidate, rows, against),
            spreads: { [def.name]: repetitionSpread(all.examples) },
            errors: all.errors.length,
          });
          continue;
        }
        const r = await experiment("candidata");
        console.log(
          `\n${def.name} · experimento ${r.experimentId ?? "?"} · ${r.runs} execuções${plan.repetitions > 1 ? ` (${plan.repetitions} por caso)` : ""}`,
        );
        printScores(r);
        if (Object.values(r.scores).some((s) => s.mean < 1)) failed++;
        if (r.errors.length) failed++;
        stopOnError(r);
        gate.record(
          def.name,
          Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, v.mean])),
          {
            versionId: def.hash,
            errors: r.errors.length,
            samples: plan.repetitions,
            ...(commit ? { commit } : {}),
          },
        );
        if (!op) continue;
        // lado A: amostras novas da versão aprovada (a saída guardada venceu o gate anterior e fica acima da média)
        let against: PromptExample[] | undefined;
        const approvedHash = approved.find((a) => a.versionId !== def.hash)?.versionId;
        if (plan.approvedSide && approvedHash) {
          const version = await approvedPromptVersion(def, approvedHash, { baseUrl });
          if (!version)
            console.log(
              `  ! versão aprovada (${approvedHash.slice(0, 12)}) fora do histórico do Phoenix: o lado A é a saída guardada.`,
            );
          else {
            const a = await experiment("aprovada", { version });
            console.log(
              `  lado A (versão aprovada) · experimento ${a.experimentId ?? "?"} · ${a.runs} execuções`,
            );
            for (const e of a.errors) console.log(`  ✘ modelo (lado A): ${e}`);
            stopOnError(a);
            against = a.examples;
          }
        }
        const cmp = await gate.pairwise(def.name, {
          versionId: def.hash,
          commit,
          judge: judgeFor(op),
          provider: judgeProvider,
          runs: promptPairRuns(r.examples, rows, against),
          feature: plan.feature,
          features: featureResults(r.examples, plan.feature),
        });
        const runIds = new Map(r.examples.map((e) => [e.exampleId, e.runId]));
        await recordPairwiseEvaluations(
          cmp.cases.flatMap((c) => {
            const runId = runIds.get(c.exampleId);
            return runId ? [{ runId, outcome: c.outcome, explanation: c.explanation }] : [];
          }),
          { baseUrl },
        );
      } catch (e) {
        if (e instanceof PromptRunStopped || isUsageLimit((e as Error).message)) throw e;
        failed++;
        console.log(`\n${def.name} · erro: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.log(
      `\nRodada parada: ${(e as Error).message}\nO que terminou está em ${checkpointPath()}: rode o mesmo comando para retomar${isUsageLimit((e as Error).message) ? " depois que o limite de uso renovar" : ""} (--fresh começa do zero).`,
    );
    return 1;
  }
  console.log(
    `\n${targets.length} prompts rodados no Phoenix (${baseUrl}); ${failed} avaliações abaixo de 100%.`,
  );
  const regressed = gate.finish();
  if (gate.wroteBaseline || gate.wroteNoise) cp?.clear();
  return (strict && failed > 0) || regressed ? 1 : 0;
}
