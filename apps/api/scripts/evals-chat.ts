import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initTelemetry, parseEvalCases, shutdownTelemetry } from "@narnia-jobs/core";
import { contentTracingEnabled } from "@narnia-jobs/shared";
import { recordPhoenixExperiment } from "../src/evals/phoenix";
import { runEvalCases } from "../src/evals/run";

/**
 * F04/M5 · `scripts/claude-env.sh evals [--strict] [id…]`: roda as conversas de referência de `evals/chat/*.jsonl`
 * contra a API desta instância e registra os resultados no Phoenix: spans `eval.case` (projeto `narnia-evals`) e um
 * experimento no dataset `narnia-chat` (auditoria E2). Nunca na CI.
 */
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const only = args.filter((a) => !a.startsWith("--"));
const dir = process.env.NARNIA_EVALS_DIR ?? join(process.cwd(), "../../evals/chat");
const cases = readdirSync(dir)
  .filter((f) => f.endsWith(".jsonl"))
  .flatMap((f) => parseEvalCases(readFileSync(join(dir, f), "utf8")))
  .filter((c) => only.length === 0 || only.includes(c.id));

await initTelemetry({ ...process.env, NARNIA_OTEL_PROJECT: "narnia-evals" }, "narnia-evals");
const report = await runEvalCases(cases, {
  baseUrl: process.env.NARNIA_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3100"}`,
  token: process.env.NARNIA_TOKEN ?? "",
});
await shutdownTelemetry();

// Phoenix: NARNIA_PHOENIX_URL ou a origem do NARNIA_OTEL_ENDPOINT (ex. http://phoenix:6006/v1/traces)
const otel = process.env.NARNIA_OTEL_ENDPOINT?.trim();
const phoenixUrl = process.env.NARNIA_PHOENIX_URL?.trim() || (otel ? new URL(otel).origin : "");
if (phoenixUrl && report.length > 0) {
  try {
    const exp = await recordPhoenixExperiment(cases, report, {
      baseUrl: phoenixUrl,
      name: `chat ${process.env.NARNIA_PROVIDER ?? "claude-code"} ${new Date().toISOString().slice(0, 16)}`,
      content: contentTracingEnabled(),
    });
    console.log(
      `Phoenix: experimento ${exp.experimentId} no dataset narnia-chat (${exp.runs} execuções)`,
    );
  } catch (e) {
    console.log(`Phoenix: não registrei o experimento (${(e as Error).message})`);
  }
}

for (const r of report) {
  console.log(`${r.passed ? "✔" : "✘"} ${r.id}${r.error ? ` · erro: ${r.error}` : ""}`);
  for (const g of r.results) console.log(`    ${g.passed ? "✔" : "✘"} ${g.type}: ${g.detail}`);
}
const failed = report.filter((r) => !r.passed).length;
console.log(`\n${report.length - failed}/${report.length} casos aprovados`);
process.exit(strict && failed > 0 ? 1 : 0);
