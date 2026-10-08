import { useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { useProfiles } from "../../hooks/useProfiles";
import { useSuggestions } from "../../hooks/useSuggestions";
import { t } from "../../i18n";
import { AnalyzeProfilesDialog } from "./AnalyzeProfilesDialog";
import { ProfileList } from "./ProfileList";
import { profileErrorMessage } from "./profile-errors";
import { SuggestionList } from "./SuggestionList";

/** `/perfis` (F02 §4): lista com ações, "Analisar possíveis perfis" e sugestões. */
export function ProfilesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const list = useProfiles({ includeArchived: showArchived });
  const suggestions = useSuggestions();

  const onError = (error: unknown) => setActionError(profileErrorMessage(error));
  const actions = {
    activate: (id: string) => {
      setActionError(null);
      list.activate.mutate(id, { onError });
    },
    archive: (id: string) => {
      setActionError(null);
      list.archive.mutate(id, { onError });
    },
    unarchive: (id: string) => {
      setActionError(null);
      list.unarchive.mutate(id, { onError });
    },
    rename: (id: string, name: string) => {
      setActionError(null);
      list.rename.mutate({ id, name }, { onError });
    },
  };

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("profiles.title")}</h1>
          <p className="text-sm text-muted-fg">{t("profiles.hint")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAnalyzeOpen(true)}>
            {t("profiles.analyze.button")}
          </Button>
          <NavLink
            to="/perfis/novo"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            {t("profiles.newProfile")}
          </NavLink>
        </div>
      </div>
      {started ? <Alert tone="ok">{t("profiles.analyze.started")}</Alert> : null}
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label={t("profiles.showArchived")}
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        {t("profiles.showArchived")}
      </label>
      {list.isLoading ? (
        <p className="text-sm text-muted-fg">{t("app.loading")}</p>
      ) : (
        <ProfileList profiles={list.profiles} actions={actions} />
      )}
      <SuggestionList
        suggestions={suggestions.suggestions}
        onDismiss={(id) => suggestions.dismiss.mutate(id)}
      />
      <AnalyzeProfilesDialog
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        onStarted={() => setStarted(true)}
      />
    </div>
  );
}
