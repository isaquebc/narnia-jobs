import {
  type ChatIngestPort,
  IngestError,
  ingestModelsForDepth,
  previousRunsForFile,
} from "@narnia-jobs/core";
import {
  confirmIngestion,
  type IngestionStartDeps,
  startFileRun,
  startGithubRun,
} from "../routes/ingestions";
import { storeText } from "../services/files";

/**
 * Ingestão pela conversa (F04-16): as mesmas funções que as rotas usam (`startFileRun`, `startGithubRun`, `storeText`),
 * para a conversa e a tela seguirem o mesmo caminho (estimativa, confirmação do GitHub, conferência). Texto e
 * arquivo seguem a regra da tela (auditoria E1, §1.4/§7): abaixo de `ingest.auto_confirm_below` começam na hora; acima
 * a execução espera confirmação e o recrutador chama `ingest.confirm` depois que o usuário concordar com o custo.
 * `params.chat.sessionId` marca a conversa que criou a execução (null = terminal): só ela confirma.
 */
export function createChatIngestPort(
  deps: IngestionStartDeps,
  sessionId: string | null = null,
): ChatIngestPort {
  const fileRun = async (fileId: string, alreadyRead: boolean) => {
    const started = await startFileRun(
      deps,
      fileId,
      {},
      { confirmByThreshold: true, params: { chat: { sessionId } } },
    );
    if (!started) throw new Error(`Arquivo não encontrado: ${fileId}`);
    return {
      runId: started.run.id,
      status: started.run.status,
      estimatedTokens: started.estimatedTokens,
      needsConfirmation: started.run.status === "awaiting_confirmation",
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
    async confirm(runId) {
      const run = deps.repos.ingestionRuns.get(runId);
      if (!run) throw new IngestError("run_not_found", `Execução não encontrada: ${runId}`);
      const origin = (run.params as { chat?: { sessionId?: string | null } }).chat;
      // só a conversa que criou (GitHub confirma o orçamento na tela, F03-13)
      if (!run.fileId || !origin || (origin.sessionId ?? null) !== sessionId)
        throw Object.assign(
          new Error(
            "Só dá para confirmar aqui uma ingestão de texto ou arquivo criada por esta conversa; as demais se confirmam na tela da execução.",
          ),
          { code: "run_not_in_session" },
        );
      const r = await confirmIngestion(deps, runId);
      return { runId, status: r.status };
    },
  };
}
