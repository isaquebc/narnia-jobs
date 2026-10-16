import { useState } from "react";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { useDocuments } from "../../hooks/useDocuments";
import { type TKey, t } from "../../i18n";
import type { ProfileRecord } from "../../lib/api";
import { DocumentPanel } from "./DocumentPanel";
import { GenerateDialog } from "./GenerateDialog";

/**
 * Perfil › Currículo (F05 R1, R3, R5, F05-17): o CV do perfil (gerar, atualizar, baixar) e os CVs e cartas de vagas
 * feitos com este perfil, com o link para cada vaga. `?gerar=1` (botão sugerido pelo recrutador) abre o "Gerar".
 */
export function ProfileCvTab({
  profile,
  openGenerate = false,
}: {
  profile: ProfileRecord;
  openGenerate?: boolean;
}) {
  const { documents, isLoading } = useDocuments({ profileId: profile.id });
  const [generating, setGenerating] = useState(openGenerate);
  const own = documents.find((d) => d.document.kind === "cv" && d.document.postingId === null);
  const fromPostings = documents.filter((d) => d.document.postingId !== null);
  if (isLoading) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  return (
    <div className="flex flex-col gap-4">
      {own ? (
        <DocumentPanel view={own} />
      ) : (
        <Card className="flex flex-col items-start gap-2 p-4">
          <p className="text-sm text-muted-fg">{t("documents.empty")}</p>
          <Button type="button" onClick={() => setGenerating(true)}>
            {t("documents.generateProfileCv")}
          </Button>
        </Card>
      )}
      <section aria-label={t("documents.postingDocs")} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("documents.postingDocs")}</h2>
        {fromPostings.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("documents.postingDocsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {fromPostings.map((d) => (
              <li key={d.document.id} className="flex flex-wrap items-center gap-2">
                <span>{t(`documents.kinds.${d.document.kind}` as TKey)}</span>
                {d.current ? (
                  <Badge>{t(`documents.status.${d.current.status}` as TKey)}</Badge>
                ) : null}
                <NavLink
                  to={`/vagas/${d.document.postingId}`}
                  search={{ doc: d.document.id } as never}
                  className="underline"
                >
                  {t("documents.openPosting")}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </section>
      <GenerateDialog
        open={generating}
        onOpenChange={setGenerating}
        kind="cv"
        postingId={null}
        profiles={[{ id: profile.id, name: profile.name }]}
        defaultProfileId={profile.id}
      />
    </div>
  );
}
