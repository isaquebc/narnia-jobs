import { type ChatIngestPort, ingestModelsForDepth, previousRunsForFile } from "@narnia-jobs/core";
import { type IngestionStartDeps, startFileRun, startGithubRun } from "../routes/ingestions";
import { storeText } from "../services/files";

/**
 * Ingestão pela conversa (F04-16): as mesmas funções que as rotas usam (`startFileRun`, `startGithubRun`, `storeText`),
 * para a conversa e a tela seguirem o mesmo caminho (estimativa, confirmação do GitHub, conferência). Texto e
 * arquivo começam na hora: o recrutador já pediu a confirmação na conversa e informou o custo (F04-18 no plano).
 */
export function createChatIngestPort(deps: IngestionStartDeps): ChatIngestPort {
  const fileRun = async (fileId: string, alreadyRead: boolean) => {
    const started = await startFileRun(deps, fileId);
    if (!started) throw new Error(`Arquivo não encontrado: ${fileId}`);
    return {
      runId: started.run.id,
      status: started.run.status,
      estimatedTokens: started.estimatedTokens,
      needsConfirmation: false,
      alreadyRead,
    };
  };
  return {
    async startText(text) {
      const stored = await storeText(deps.repos, deps.dataDir, text);
      return fileRun(stored.file.id, !stored.created);
    },
    async startFile(fileId) {
      return fileRun(fileId, previousRunsForFile(deps.repos, fileId).length > 0);
    },
    async startGithub(req) {
      const { run, budget } = await startGithubRun(deps, {
        source: "github",
        mode: req.mode,
        repos: req.repos,
        depth: req.depth,
        // sem modelo escolhido na conversa: o padrão da profundidade (F03-5)
        model: req.model ?? ingestModelsForDepth(deps.repos.settings, req.depth).repo,
        ...(req.login ? { login: req.login } : {}),
      });
      return {
        runId: run.id,
        status: run.status,
        estimatedTokens: budget.amount,
        needsConfirmation: true,
      };
    },
  };
}
