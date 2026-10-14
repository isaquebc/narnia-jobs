import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApi } from "../../../app/context";
import { describeError, ErrorState } from "../../../components/ErrorState";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Tooltip } from "../../../components/ui/tooltip";
import { useIngestion } from "../../../hooks/useIngestion";
import { t } from "../../../i18n";
import {
  IdentityForm,
  type IdentityProposalData,
  type IdentityValue,
  identityFromProposal,
  toUserUpsertRequest,
} from "../components/IdentityForm";
import { type Decision, type ProposalItem, ProposalList } from "../components/ProposalList";
import type { StepProps } from "../Wizard";

export function StepReview({ state, go }: StepProps) {
  const api = useApi();
  const qc = useQueryClient();
  const ingestion = useIngestion(state.runId);
  const user = useQuery({ queryKey: ["user"], queryFn: () => api.getUser() });
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [blocked, setBlocked] = useState<string | null>(null);

  const proposals = ingestion.data?.proposals ?? [];
  const identityProposal = proposals.find((p) => p.proposal.kind === "identity");
  const items: ProposalItem[] = useMemo(
    () =>
      proposals
        .filter((p) => p.proposal.kind !== "identity")
        .map((p) => ({
          id: p.id,
          proposal: p.proposal,
          decision: p.decision,
          origin: p.origin,
          ...(p.reference ? { reference: p.reference } : {}),
        })),
    [proposals],
  );
  const effective = useMemo(() => {
    const map: Record<string, Decision> = {};
    for (const p of items) {
      if (p.decision !== "pending") map[p.id] = { decision: p.decision };
    }
    return { ...map, ...decisions };
  }, [items, decisions]);
  const pendingCount = items.filter((p) => !effective[p.id]).length;

  const initial: IdentityValue = useMemo(
    () =>
      identityFromProposal(
        (identityProposal?.proposal.data as IdentityProposalData | undefined) ?? {},
      ),
    [identityProposal],
  );

  const submit = useMutation({
    mutationFn: async (value: IdentityValue) => {
      if (state.runId && proposals.length > 0) {
        const list = [
          ...(identityProposal && identityProposal.decision === "pending"
            ? [{ proposalId: identityProposal.id, decision: "accepted" as const }]
            : []),
          ...items
            .filter((p) => p.decision === "pending" && effective[p.id])
            .map((p) => {
              const d = effective[p.id] as Decision;
              return d.decision === "edited"
                ? { proposalId: p.id, decision: "edited" as const, editedData: d.editedData ?? {} }
                : { proposalId: p.id, decision: d.decision };
            }),
        ];
        if (list.length > 0) await api.reviewIngestion(state.runId, { decisions: list });
      }
      await api.putUser(toUserUpsertRequest(value));
      // TimezoneSync, o dashboard e o passo 5 compartilham a chave; sem invalidar, o cache de 5 s mostra o usuário antigo
      await qc.invalidateQueries({ queryKey: ["user"] });
      await go({ step: 5 });
    },
  });

  if (state.runId && ingestion.isError)
    return <ErrorState error={ingestion.error} onRetry={() => void ingestion.refetch()} />;
  if (state.runId && !ingestion.data)
    return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const loadedInitial = user.data?.user
    ? ({
        ...initial,
        displayName: user.data.user.displayName,
        fullName: user.data.user.fullName,
        email: user.data.user.email,
        phone: {
          country: user.data.user.phone.country,
          area: "",
          number: user.data.user.phone.national,
        },
        city: user.data.user.city,
        country: user.data.user.country,
        timezone: user.data.user.timezone,
      } satisfies IdentityValue)
    : initial;

  return (
    <Card className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">{t("review.title")}</h2>
        <p className="text-sm text-muted-fg">{t("review.hint")}</p>
      </div>
      {user.isLoading ? (
        <p className="text-sm text-muted-fg">{t("app.loading")}</p>
      ) : (
        <IdentityForm
          key={user.data?.user?.id ?? identityProposal?.id ?? "blank"}
          initial={loadedInitial}
          submitLabel={t("app.next")}
          externalError={submit.isError ? describeError(submit.error).title : blocked}
          footer={
            items.length > 0 ? (
              <div className="flex flex-col gap-3">
                <ProposalList
                  proposals={items}
                  decisions={effective}
                  onDecide={(id, decision, editedData) =>
                    setDecisions((d) => {
                      const next = { ...d };
                      if (decision === "pending") delete next[id];
                      else next[id] = editedData ? { decision, editedData } : { decision };
                      return next;
                    })
                  }
                />
                <div>
                  <Tooltip content={t("review.clarifySoon")}>
                    <span className="inline-block">
                      <Button variant="outline" disabled>
                        {t("review.clarify")}
                      </Button>
                    </span>
                  </Tooltip>
                </div>
              </div>
            ) : null
          }
          onSubmit={(value) => {
            if (pendingCount > 0) {
              setBlocked(t("review.pending", { count: pendingCount }));
              return;
            }
            setBlocked(null);
            submit.mutate(value);
          }}
        />
      )}
      {submit.isPending ? <Alert>{t("app.loading")}</Alert> : null}
    </Card>
  );
}
