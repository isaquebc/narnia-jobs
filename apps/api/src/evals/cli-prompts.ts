import { BaselineGate, gateFlags } from "./baseline-file";
import { syncEvaluators } from "./eval-sync";
import { createPhoenixAdmin, phoenixBaseUrl } from "./phoenix-admin";
import { runPromptExperiment } from "./phoenix-run";
import { gitCommit } from "./phoenix-setup";
import { promptCatalog } from "./prompt-catalog";
import { syncPrompts } from "./prompt-sync";

/**
 * Avaliações no Phoenix (M5) · `./start.sh evals prompts [nome…] [--strict] [--gate] [--update-baseline]`: sincroniza prompts, datasets e
 * avaliadores e roda cada prompt estruturado sobre o dataset dele como experimento do Phoenix (versão `production`,
 * modelo pela ponte da assinatura, avaliadores rodando no Phoenix). Não grava nada no banco do narnia-jobs além do uso
 * no medidor. Prompts que usam tools (leitura do PDF) ficam de fora: o Playground não executa tools. `--gate` falha
 * quando um avaliador cai abaixo da linha de base de `evals/baselines.json` (F06-14); `--update-baseline` grava as
 * notas desta rodada como a nova linha de base, se não houver regressão.
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
  for (const def of targets) {
    try {
      const r = await runPromptExperiment(def, {
        baseUrl,
        customProviderId: status.providerId,
        commit,
      });
      console.log(`\n${def.name} · experimento ${r.experimentId ?? "?"} · ${r.runs} execuções`);
      for (const e of r.errors) console.log(`  ✘ modelo: ${e}`);
      for (const [name, s] of Object.entries(r.scores)) {
        const mark = s.mean >= 1 ? "✔" : s.mean >= 0.5 ? "~" : "✘";
        console.log(`  ${mark} ${name}: ${(s.mean * 100).toFixed(0)}% (${s.n})`);
        for (const why of s.failed) console.log(`      ${why}`);
        if (s.mean < 1) failed++;
      }
      for (const e of r.evaluatorErrors) console.log(`  ! avaliador: ${e}`);
      if (r.errors.length) failed++;
      gate.record(
        def.name,
        Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, v.mean])),
        { versionId: def.hash, ...(commit ? { commit } : {}) },
      );
    } catch (e) {
      failed++;
      console.log(`\n${def.name} · erro: ${(e as Error).message}`);
    }
  }
  console.log(
    `\n${targets.length} prompts rodados no Phoenix (${baseUrl}); ${failed} avaliações abaixo de 100%.`,
  );
  const regressed = gate.finish();
  return (strict && failed > 0) || regressed ? 1 : 0;
}
