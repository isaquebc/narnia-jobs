import type { OnboardingState } from "@narnia-jobs/shared";
import { useNavigate } from "@tanstack/react-router";
import { ErrorState } from "../../components/ErrorState";
import { useOnboardingState } from "../../hooks/useOnboarding";
import { t } from "../../i18n";
import { cn } from "../../lib/cn";
import { StepDiscovery } from "./steps/StepDiscovery";
import { StepExtraction } from "./steps/StepExtraction";
import { StepProfile } from "./steps/StepProfile";
import { StepProvider } from "./steps/StepProvider";
import { StepReview } from "./steps/StepReview";
import { StepSource } from "./steps/StepSource";

/** Passo 6 = "Entrevista de descoberta" (passo 7 de 02-fluxos; "Mais fontes" não está no wizard). */
export const TOTAL_STEPS = 6;
const STEP_KEYS = ["provider", "source", "extraction", "review", "profile", "discovery"] as const;

export interface StepProps {
  state: OnboardingState;
  /** Grava o estado e navega para o passo indicado. */
  go: (patch: Partial<OnboardingState> & { step: number }) => Promise<void>;
  finish: () => Promise<void>;
}

export function Wizard({ step }: { step: number }) {
  const navigate = useNavigate();
  const { data, isError, error, refetch, save } = useOnboardingState();
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const current = Math.min(Math.max(step, 1), TOTAL_STEPS);

  const go: StepProps["go"] = async (patch) => {
    const next = await save.mutateAsync({ ...data, ...patch, completed: false });
    await navigate({ to: "/onboarding/$step", params: { step: String(next.step) } });
  };
  const finish: StepProps["finish"] = async () => {
    await save.mutateAsync({ ...data, step: TOTAL_STEPS, completed: true });
    await navigate({ to: "/dashboard" });
  };
  const props: StepProps = { state: data, go, finish };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t("wizard.title")}</h1>
        <p className="text-sm text-muted-fg">
          {t("wizard.stepOf", { current, total: TOTAL_STEPS })}
        </p>
        <ol className="flex gap-2">
          {STEP_KEYS.map((key, i) => (
            <li
              key={key}
              className={cn(
                "flex-1 rounded-full border px-3 py-1 text-center text-xs",
                i + 1 === current
                  ? "border-primary bg-primary text-primary-fg"
                  : i + 1 < current
                    ? "border-ok/40 bg-ok/10"
                    : "border-border",
              )}
            >
              {t(`wizard.steps.${key}`)}
            </li>
          ))}
        </ol>
        {data.step > current ? <p className="text-xs text-muted-fg">{t("wizard.resume")}</p> : null}
      </header>
      {current === 1 ? <StepProvider {...props} /> : null}
      {current === 2 ? <StepSource {...props} /> : null}
      {current === 3 ? <StepExtraction {...props} /> : null}
      {current === 4 ? <StepReview {...props} /> : null}
      {current === 5 ? <StepProfile {...props} /> : null}
      {current === 6 ? <StepDiscovery {...props} /> : null}
    </div>
  );
}
