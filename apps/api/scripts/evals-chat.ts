import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initTelemetry, parseEvalCases, shutdownTelemetry } from "@narnia-jobs/core";
import { runEvalCases } from "../src/evals/run";

/**
 * F04/M5 · `scripts/claude-env.sh evals [--strict] [id…]`: roda as conversas de referência de `evals/chat/*.jsonl`
 * contra a API desta instância e registra os resultados no Phoenix (projeto `narnia-evals`). Nunca na CI.
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

for (const r of report) {
  console.log(`${r.passed ? "✔" : "✘"} ${r.id}${r.error ? ` · erro: ${r.error}` : ""}`);
  for (const g of r.results) console.log(`    ${g.passed ? "✔" : "✘"} ${g.type}: ${g.detail}`);
}
const failed = report.filter((r) => !r.passed).length;
console.log(`\n${report.length - failed}/${report.length} casos aprovados`);
process.exit(strict && failed > 0 ? 1 : 0);
