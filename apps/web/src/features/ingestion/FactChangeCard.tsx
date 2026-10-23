import type { FactChange } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ingestionKey } from "../../hooks/useIngestion";
import { type TKey, t } from "../../i18n";
import type { IngestionDetail } from "../../lib/api";
import { conflictValue } from "./ReviewPanel";

/**
 * Alteração pequena pedida na conversa (pedido do dono, 2026-10-23): o recrutador propôs (`fact.propose_change`) e o
 * usuário confirma ou mantém. O mesmo cartão fica no painel da conversa e na tela da execução, que é o link da
 * pendência em Pendências e na bandeja. Confirmar aceita a proposta (o conflito já vem resolvido para o valor novo).
 */
function value(field: string, v: unknown): string {
  if (typeof v === "boolean") return v ? t("factChange.yes") : t("factChange.no");
  if (Array.isArray(v) && v.every((x) => typeof x === "string"))
    return v.length ? v.join(", ") : "—";
  return conflictValue(field, v);
}

const fieldLabel = (field: string) => {
  const key = `factChange.fields.${field}` as TKey;
  const label = t(key);
  return label === key ? field : label;
};

export function FactChangeCard({ run, change }: { run: IngestionDetail; change: FactChange }) {
  const api = useApi();
  const qc = useQueryClient();
  const proposal = run.proposals[0];
  const decide = useMutation({
    mutationFn: (decision: "accepted" | "rejected") =>
      api.reviewIngestion(run.id, {
        decisions: [{ proposalId: proposal?.id as string, decision }],
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ingestionKey(run.id) });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const decided = proposal && proposal.decision !== "pending" ? proposal.decision : null;
  return (
    <section
      aria-label={t("factChange.title")}
      className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{t("factChange.title")}</span>
        <span className="text-xs text-muted-fg">
          {t(`factChange.kinds.${change.kind}` as TKey)} · {change.label}
        </span>
      </div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-muted-fg">
            <th className="py-1 pr-2 font-normal">{t("factChange.field")}</th>
            <th className="py-1 pr-2 font-normal">{t("factChange.before")}</th>
            <th className="py-1 font-normal">{t("factChange.after")}</th>
          </tr>
        </thead>
        <tbody>
          {change.changes.map((c) => (
            <tr key={c.field} aria-label={fieldLabel(c.field)} className="border-t border-border">
              <th scope="row" className="py-1 pr-2 font-medium">
                {fieldLabel(c.field)}
              </th>
              <td className="py-1 pr-2 text-muted-fg line-through">{value(c.field, c.before)}</td>
              <td className="py-1">{value(c.field, c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs">
        <span className="font-medium">{t("factChange.reason")}:</span> {change.reason}
      </p>
      <blockquote className="border-l-2 border-border pl-2 text-xs italic text-muted-fg">
        “{change.quote}”
      </blockquote>
      <div>
        <Badge tone={change.quoteFound ? "ok" : "neutral"}>
          {change.quoteFound ? t("factChange.quoteFound") : t("factChange.quoteUnchecked")}
        </Badge>
      </div>
      {decided ? (
        <p role="status" className="text-xs text-muted-fg">
          {decided === "rejected" ? t("factChange.kept") : t("factChange.applied")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("accepted")}>
            {t("factChange.confirm")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate("rejected")}
          >
            {t("factChange.keep")}
          </Button>
        </div>
      )}
      {decide.isError ? <Alert tone="danger">{(decide.error as Error).message}</Alert> : null}
    </section>
  );
}
