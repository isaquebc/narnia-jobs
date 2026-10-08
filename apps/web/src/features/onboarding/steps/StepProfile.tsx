import { useMutation, useQuery } from "@tanstack/react-query";
import { useApi } from "../../../app/context";
import { describeError, ErrorState } from "../../../components/ErrorState";
import { Card } from "../../../components/ui/card";
import { t } from "../../../i18n";
import { ProfileForm } from "../components/ProfileForm";
import type { StepProps } from "../Wizard";

export function StepProfile({ state, finish }: StepProps) {
  const api = useApi();
  const user = useQuery({ queryKey: ["user"], queryFn: () => api.getUser() });
  const suggestion = useQuery({
    queryKey: ["profile", "suggestion", state.runId ?? null],
    queryFn: () => api.getProfileSuggestion(state.runId),
  });
  const country = user.data?.user?.country ?? "BR";
  const reference = useQuery({
    queryKey: ["salary-reference", country],
    queryFn: () => api.getSalaryReference(country),
    enabled: Boolean(user.data),
  });
  const create = useMutation({
    mutationFn: async (body: Parameters<typeof api.createProfile>[0]) => {
      await api.createProfile(body);
      await finish();
    },
  });
  if (user.isError) return <ErrorState error={user.error} onRetry={() => void user.refetch()} />;
  if (!user.data || suggestion.isLoading)
    return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{t("profile.title")}</h2>
        <p className="text-sm text-muted-fg">{t("profile.hint")}</p>
      </div>
      <ProfileForm
        suggestion={suggestion.data ?? null}
        userCountry={country}
        reference={reference.data?.reference ?? null}
        submitting={create.isPending}
        externalError={create.isError ? describeError(create.error).title : null}
        onSubmit={(body) => create.mutate(body)}
      />
    </Card>
  );
}
