import { INGEST_TOOLS, type IngestToolName } from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import { readDigestText } from "../digest";
import { IngestError } from "./errors";

/**
 * Handlers puros das tools MCP `file.*` e `ingest.*` (F03 §1, §6.2): validam entrada e saída pelos schemas de
 * `packages/shared/src/mcp/ingest.ts`; exposição pelo servidor MCP na F04. Nunca devolvem um arquivo inteiro.
 */
type In<N extends IngestToolName> = z.infer<(typeof INGEST_TOOLS)[N]["input"]>;
type Out<N extends IngestToolName> = z.infer<(typeof INGEST_TOOLS)[N]["output"]>;
export type IngestToolHandlers = { [N in IngestToolName]: (input: unknown) => Out<N> };

export const INGEST_TOOL_NAMES = Object.keys(INGEST_TOOLS) as IngestToolName[];
const CLOSED = new Set(["done", "cancelled", "error"]);

export function createIngestTools(repos: Repos, o: { dataDir: string }): IngestToolHandlers {
  const wrap = <N extends IngestToolName>(name: N, impl: (input: In<N>) => Out<N>) => {
    const def = INGEST_TOOLS[name];
    return (raw: unknown): Out<N> =>
      def.output.parse(impl(def.input.parse(raw) as In<N>)) as Out<N>;
  };

  const runOrThrow = (runId: string) => {
    const run = repos.ingestionRuns.get(runId);
    if (!run) throw new IngestError("run_not_found", `Execução não encontrada: ${runId}`);
    return run;
  };

  return {
    "file.list": wrap("file.list", (input) => {
      const files = repos.sourceFiles.list().map((f) => ({
        subjectKind: "file" as const,
        id: f.id,
        name: f.originalName ?? (f.kind === "text" ? "Texto livre" : "Currículo"),
        kind: f.kind,
        date: f.uploadedAt,
        hasDigest: repos.digests.get(f.id) !== null,
      }));
      const repoItems = repos.repos.list().map((r) => ({
        subjectKind: "repo" as const,
        id: r.id,
        name: r.fullName,
        kind: "github",
        date: r.pushedAt,
        hasDigest: repos.repoDigests.get(r.id) !== null,
      }));
      const items = [...files, ...repoItems]
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, input.limit ?? 50);
      return { items };
    }),
    "file.get_digest": wrap("file.get_digest", (input) => {
      if (input.fileId) {
        const d = repos.digests.get(input.fileId);
        return {
          digest: d
            ? {
                subjectKind: "file" as const,
                subjectId: d.fileId,
                summary: d.summary,
                keyPoints: d.keyPoints,
                sections: d.sections,
                meta: d.meta,
              }
            : null,
        };
      }
      const d = repos.repoDigests.get(input.repoId as string);
      return {
        digest: d
          ? {
              subjectKind: "repo" as const,
              subjectId: d.repoId,
              summary: d.summary,
              keyPoints: d.keyPoints,
              sections: d.sections,
              meta: d.meta,
            }
          : null,
      };
    }),
    "file.get_text": wrap("file.get_text", (input) => {
      if (!repos.sourceFiles.get(input.fileId)) {
        throw new IngestError("file_not_found", `Arquivo não encontrado: ${input.fileId}`);
      }
      const digest = repos.digests.get(input.fileId);
      if (!digest?.textPath) {
        throw new IngestError("text_not_found", "Arquivo ainda sem texto extraído");
      }
      const text = readDigestText(o.dataDir, digest);
      const to = Math.min(input.to, text.length);
      const from = Math.min(input.from, to);
      return { text: text.slice(from, to), from, to, total: text.length };
    }),
    "ingest.status": wrap("ingest.status", (input) => {
      const run = runOrThrow(input.runId);
      return {
        runId: run.id,
        status: run.status,
        pendingProposals: repos.proposals.listByRun(run.id).filter((p) => p.decision === "pending")
          .length,
        usedTokens: repos.ingestionRuns.usedTokens(run.id),
      };
    }),
    "ingest.propose": wrap("ingest.propose", (input) => {
      const run = runOrThrow(input.runId);
      if (CLOSED.has(run.status)) {
        throw new IngestError("run_closed", `Execução encerrada (${run.status})`);
      }
      const ids = repos.proposals.insertMany(
        run.id,
        input.proposals.map((p) => p.proposal),
        input.proposals.map((p) => p.evidence),
      );
      return { added: ids.length };
    }),
  };
}
