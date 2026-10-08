import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BuildDigestOutput } from "@narnia-jobs/shared";
import type { DigestRecord, Repos } from "../db";

export interface SaveDigestInput {
  fileId: string;
  sha256: string;
  /** Texto canônico consolidado (F01 §2.5): fica em `digests/<sha>.txt`, nunca inteiro no contexto do modelo. */
  text: string;
  digest: BuildDigestOutput;
}

/** Persiste texto + registro de contexto. Se o usuário editou o digest, resumo/pontos/seções são preservados. */
export function saveDigest(repos: Repos, dataDir: string, input: SaveDigestInput): DigestRecord {
  const textPath = join("digests", `${input.sha256}.txt`);
  const abs = join(dataDir, textPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.text, "utf8");
  return repos.digests.upsert({
    fileId: input.fileId,
    summary: input.digest.summary,
    keyPoints: input.digest.keyPoints,
    sections: input.digest.sections,
    meta: input.digest.meta,
    editedByUser: false,
    textPath,
  });
}

export function readDigestText(dataDir: string, record: Pick<DigestRecord, "textPath">): string {
  if (!record.textPath) throw new Error("Digest sem texto associado");
  return readFileSync(join(dataDir, record.textPath), "utf8");
}
