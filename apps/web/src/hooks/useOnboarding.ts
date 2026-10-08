import type { OnboardingState } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../app/context";

export const onboardingKey = ["onboarding", "state"] as const;

export function useOnboardingState() {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: onboardingKey, queryFn: () => api.getOnboardingState() });
  const save = useMutation({
    mutationFn: (state: OnboardingState) => api.putOnboardingState(state),
    onSuccess: (state) => qc.setQueryData(onboardingKey, state),
  });
  return { ...query, save };
}
