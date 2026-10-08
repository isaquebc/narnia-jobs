import { Alert } from "../../components/ui/alert";
import { useSuggestions } from "../../hooks/useSuggestions";
import { t } from "../../i18n";
import { SuggestionItem } from "./SuggestionList";

/** Banner do dashboard (F02 §4): primeira sugestão nova, com aceitar/dispensar; só consulta quando há alguma. */
export function SuggestionBanner({ count }: { count: number }) {
  const { suggestions, dismiss } = useSuggestions({ enabled: count > 0 });
  const first = suggestions[0];
  if (count === 0 || !first) return null;
  return (
    <Alert className="flex flex-col gap-2">
      <p className="font-medium">
        {first.source === "model"
          ? t("suggestions.bannerModel", { title: first.payload.title })
          : t("suggestions.banner", { title: first.payload.title })}
      </p>
      <SuggestionItem suggestion={first} onDismiss={(id) => dismiss.mutate(id)} compact />
    </Alert>
  );
}
