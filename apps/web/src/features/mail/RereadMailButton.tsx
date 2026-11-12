import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Button } from "../../components/ui/button";
import { t } from "../../i18n";

/**
 * "Ler de novo" (pedido do dono 2026-11-12, para testar a leitura nova num e-mail só): desfaz o que o e-mail criou e o
 * lê já, com o algoritmo atual. `mailId` aceita o id do e-mail ou o do Gmail.
 */
export function RereadMailButton({ mailId }: { mailId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const reread = useMutation({
    mutationFn: () => api.rereadMail(mailId),
    // candidaturas, vagas, e-mails e notificações mudam juntos
    onSettled: () => qc.invalidateQueries(),
  });
  const kept = reread.data?.kept ?? [];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={reread.isPending}
        onClick={() => window.confirm(t("scheduled.rereadConfirm")) && reread.mutate()}
      >
        {t("scheduled.reread")}
      </Button>
      {reread.data ? (
        <span role="status" className="text-xs text-muted-fg">
          {kept.length ? kept.map((k) => k.reason).join("; ") : t("scheduled.rereadDone")}
        </span>
      ) : null}
      {reread.error ? (
        <span className="text-xs text-danger">{describeError(reread.error).title}</span>
      ) : null}
    </span>
  );
}
