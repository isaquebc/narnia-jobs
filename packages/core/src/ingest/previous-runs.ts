import type { RunStatus } from "@narnia-jobs/shared";
import type { Repos } from "../db";

/** "Já lido" (F03 §2.9-5): execuções anteriores do mesmo conteúdo, mais novas primeiro. */
export interface PreviousRun {
  runId: string;
  status: RunStatus;
  createdAt: string;
}

export function previousRunsForFile(repos: Repos, fileId: string): PreviousRun[] {
  return repos.ingestionRuns
    .listByFile(fileId)
    .map((r) => ({ runId: r.id, status: r.status, createdAt: r.createdAt }));
}

export function previousRunsForSha(repos: Repos, sha256: string): PreviousRun[] {
  const file = repos.sourceFiles.findBySha256(sha256);
  return file ? previousRunsForFile(repos, file.id) : [];
}
