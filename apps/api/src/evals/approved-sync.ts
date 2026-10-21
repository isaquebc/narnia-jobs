import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseApproved } from "@narnia-jobs/core";
import { baselinePath } from "./baseline-file";
import { recordLocalExperiment } from "./local-eval";

/**
 * Versões aprovadas no Phoenix (M7, AV-6): cada `evals/approved/<prompt>.jsonl` do git vira um experimento
 * "aprovada · <versão> · <commit>" no dataset do prompt, com as saídas e as notas guardadas, sem rodar o modelo. O hash
 * do arquivo vai nos metadados: o mesmo arquivo não é ingerido duas vezes. Dataset ausente (o `narnia-chat` só existe
 * depois da primeira rodada do chat) pula o arquivo.
 */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const approvedDir = () => join(dirname(baselinePath()), "approved");

async function experimentHashes(baseUrl: string, f: FetchLike, datasetId: string) {
  const hashes = new Set<string>();
  let cursor: string | null = null;
  do {
    const q: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const r = await f(`${baseUrl}/v1/datasets/${encodeURIComponent(datasetId)}/experiments${q}`);
    if (!r.ok) throw new Error(`Phoenix: experimentos de ${datasetId} → ${r.status}`);
    const body = (await r.json()) as {
      data: Array<{ metadata?: Record<string, unknown> | null }>;
      next_cursor?: string | null;
    };
    for (const e of body.data) {
      const h = e.metadata?.approvedHash;
      if (typeof h === "string") hashes.add(h);
    }
    cursor = body.next_cursor ?? null;
  } while (cursor);
  return hashes;
}

export async function syncApproved(o: {
  baseUrl: string;
  fetch?: FetchLike;
  dir?: string;
}): Promise<{ ingested: number; skipped: number }> {
  const f: FetchLike = o.fetch ?? ((url, init) => fetch(url, init));
  const dir = o.dir ?? approvedDir();
  const out = { ingested: 0, skipped: 0 };
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)
    .filter((x) => x.endsWith(".jsonl"))
    .sort()) {
    const dataset = file.replace(/\.jsonl$/, "");
    const text = readFileSync(join(dir, file), "utf8");
    const cases = parseApproved(text);
    const first = cases[0];
    const found = first
      ? (
          (await (
            await f(`${o.baseUrl}/v1/datasets?name=${encodeURIComponent(dataset)}`)
          ).json()) as { data: Array<{ id: string; name: string }> }
        ).data.find((d) => d.name === dataset)
      : undefined;
    const hash = createHash("sha256").update(text).digest("hex");
    if (!first || !found || (await experimentHashes(o.baseUrl, f, found.id)).has(hash)) {
      out.skipped++;
      continue;
    }
    await recordLocalExperiment(
      {
        dataset,
        name: `aprovada · ${first.versionId.slice(0, 8)} · ${first.commit ?? "sem commit"}`,
        description: `narnia-jobs: versão aprovada pelo gate (evals/approved/${file}), aprovada em ${first.approvedAt}`,
        metadata: { approvedHash: hash, versionId: first.versionId, commit: first.commit },
        runs: cases.map((c) => ({
          exampleId: c.exampleId,
          output: c.output,
          startedAt: c.approvedAt,
          endedAt: c.approvedAt,
          evaluations: c.evaluations,
        })),
      },
      { baseUrl: o.baseUrl, fetch: f },
    );
    out.ingested++;
  }
  return out;
}
