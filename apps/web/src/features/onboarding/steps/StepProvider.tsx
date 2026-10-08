import { Button } from "../../../components/ui/button";
import { useProviderStatus } from "../../../hooks/useProviderStatus";
import { t } from "../../../i18n";
import { ProviderCard } from "../components/ProviderCard";
import type { StepProps } from "../Wizard";

export function StepProvider({ go }: StepProps) {
  const { data } = useProviderStatus();
  const ready = Boolean(data?.installed && data?.loggedIn);
  return (
    <div className="flex flex-col gap-4">
      <ProviderCard />
      <div className="flex justify-end">
        <Button disabled={!ready} onClick={() => void go({ step: 2 })}>
          {t("app.next")}
        </Button>
      </div>
    </div>
  );
}
