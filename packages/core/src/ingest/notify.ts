import type { Notification, NotificationKind } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { IngestionRunRecord } from "../db/repos/ingestion-runs";
import { IngestError } from "./errors";

/**
 * Notificações da ingestão (F03-10): o estado do run define quais pendências ficam abertas. Idempotente: chamar
 * de novo não duplica (upsert por tipo + assunto) e resolve sozinho o que deixou de estar pendente. Devolve os
 * eventos para a api retransmitir por WS (`created` → `notification.created`, senão `notification.updated`).
 */
export const RUN_SUBJECT = "ingestion_run";

export interface NotificationEvent {
  notification: Notification;
  created: boolean;
}

function label(repos: Repos, run: IngestionRunRecord): string {
  if (run.source === "github") {
    const n = run.params.repos?.length ?? 0;
    return `GitHub (${n} ${n === 1 ? "repositório" : "repositórios"})`;
  }
  if (run.source === "text") return "Texto livre";
  const file = run.fileId ? repos.sourceFiles.get(run.fileId) : null;
  return file?.originalName ?? "Currículo";
}

export function syncRunNotifications(repos: Repos, runId: string): NotificationEvent[] {
  const run = repos.ingestionRuns.get(runId);
  if (!run) throw new IngestError("run_not_found", `Execução não encontrada: ${runId}`);
  const name = label(repos, run);
  const actionUrl = `/ingestao/${run.id}`;
  const events: NotificationEvent[] = [];
  const upsert = (
    kind: NotificationKind,
    title: string,
    body: string | null,
    severity: Notification["severity"],
  ) => {
    events.push(
      repos.notifications.upsert({
        kind,
        subjectKind: RUN_SUBJECT,
        subjectId: run.id,
        title,
        body,
        actionUrl,
        severity,
      }),
    );
  };
  const resolve = (kinds?: NotificationKind[]) => {
    for (const n of repos.notifications.resolveSubject(RUN_SUBJECT, run.id, kinds)) {
      events.push({ notification: n, created: false });
    }
  };

  switch (run.status) {
    case "review": {
      const pending = repos.proposals.listByRun(run.id).filter((p) => p.decision === "pending");
      const conflicts = pending.filter((p) => p.match === "conflict" && !p.resolution).length;
      resolve([
        "ingestion.awaiting_decision",
        "ingestion.awaiting_confirmation",
        "ingestion.error",
      ]);
      upsert(
        "review.pending",
        `Pronta para revisão: ${name}`,
        `${pending.length} ${pending.length === 1 ? "proposta" : "propostas"} para revisar`,
        "info",
      );
      if (conflicts > 0) {
        upsert(
          "review.conflicts",
          `${conflicts} ${conflicts === 1 ? "conflito" : "conflitos"} para resolver: ${name}`,
          "Dados que divergem do que você já tem; salvar fica bloqueado até resolver",
          "warning",
        );
      } else {
        resolve(["review.conflicts"]);
      }
      break;
    }
    case "awaiting_decision":
    case "paused":
      resolve([
        "review.pending",
        "review.conflicts",
        "ingestion.error",
        "ingestion.awaiting_confirmation",
      ]);
      upsert(
        "ingestion.awaiting_decision",
        run.status === "paused" ? `Execução pausada: ${name}` : `Orçamento esgotado: ${name}`,
        run.status === "paused"
          ? "Você deixou para depois; retome quando quiser"
          : "A execução parou esperando sua decisão: continuar, encerrar ou deixar para depois",
        "warning",
      );
      break;
    case "done":
      resolve([
        "ingestion.awaiting_confirmation",
        "review.pending",
        "review.conflicts",
        "ingestion.awaiting_decision",
        "ingestion.error",
      ]);
      upsert("ingestion.done", `Ingestão concluída: ${name}`, null, "info");
      break;
    case "awaiting_confirmation":
      resolve(["ingestion.awaiting_decision", "ingestion.error"]);
      upsert(
        "ingestion.awaiting_confirmation",
        `Confirme a estimativa: ${name}`,
        "A execução está pronta e espera você confirmar o custo estimado",
        "info",
      );
      break;
    case "error":
      resolve(["ingestion.awaiting_decision", "ingestion.awaiting_confirmation"]);
      upsert("ingestion.error", `Falha na ingestão: ${name}`, run.error, "error");
      break;
    case "cancelled":
      resolve();
      break;
    default:
      // preparando, na fila ou rodando: nada pendente com o usuário além da própria tela
      resolve([
        "ingestion.awaiting_decision",
        "ingestion.awaiting_confirmation",
        "ingestion.error",
      ]);
  }
  return events;
}

/** FX-3: abrir a execução resolve a notificação informativa "ingestão concluída". */
export function markRunOpened(repos: Repos, runId: string): NotificationEvent[] {
  return repos.notifications
    .resolveSubject(RUN_SUBJECT, runId, ["ingestion.done"])
    .map((notification) => ({ notification, created: false }));
}
