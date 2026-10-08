import type { ProfileSuggestion } from "@narnia-jobs/shared";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { t } from "../../i18n";

/** Query string de `/perfis/novo` pré-preenchida a partir de uma sugestão (F02 §4). */
export function suggestionSearch(s: ProfileSuggestion): Record<string, string> {
  return {
    suggestionId: s.id,
    title: s.payload.title,
    seniority: s.payload.seniority,
    area: s.payload.area,
    market: s.payload.market,
  };
}

export function SuggestionItem({
  suggestion,
  onDismiss,
  compact,
}: {
  suggestion: ProfileSuggestion;
  onDismiss: (id: string) => void;
  compact?: boolean;
}) {
  const s = suggestion;
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{s.payload.title}</p>
        <Badge tone={s.source === "model" ? "info" : "neutral"}>
          {s.source === "model"
            ? t("suggestions.source.model", { model: s.model ?? "?" })
            : t("suggestions.source.heuristic")}
        </Badge>
      </div>
      <p className="text-xs text-muted-fg">
        {t(`profile.seniorities.${s.payload.seniority}`)} · {s.payload.area} · {s.payload.market}
      </p>
      {!compact ? (
        <>
          <p className="text-xs uppercase text-muted-fg">{t("suggestions.rationale")}</p>
          <p className="text-sm">{s.payload.rationale}</p>
          <p className="text-xs text-muted-fg">
            {t("suggestions.supporting", { count: s.payload.supportingFactIds.length })}
          </p>
        </>
      ) : null}
      <div className="flex gap-2">
        <NavLink
          to="/perfis/novo"
          search={suggestionSearch(s)}
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg"
        >
          {t("suggestions.accept")}
        </NavLink>
        <Button variant="outline" size="sm" onClick={() => onDismiss(s.id)}>
          {t("suggestions.dismiss")}
        </Button>
      </div>
    </Card>
  );
}

export function SuggestionList({
  suggestions,
  onDismiss,
}: {
  suggestions: ProfileSuggestion[];
  onDismiss: (id: string) => void;
}) {
  return (
    <section aria-label={t("suggestions.title")} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("suggestions.title")}</h2>
      {suggestions.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("suggestions.empty")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {suggestions.map((s) => (
            <SuggestionItem key={s.id} suggestion={s} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </section>
  );
}
