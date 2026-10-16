import { useDocuments } from "../../hooks/useDocuments";
import { useProfiles } from "../../hooks/useProfiles";
import { type TKey, t } from "../../i18n";
import { DocumentPanel } from "./DocumentPanel";

/** Página da vaga › Currículos e cartas (F05 R4, F05-17): um painel por documento, com o perfil de cada um. */
export function PostingDocuments({
  postingId,
  focusId,
}: {
  postingId: string;
  focusId?: string | undefined;
}) {
  const { documents } = useDocuments({ postingId });
  const { profiles } = useProfiles();
  const name = (id: string) => profiles.find((p) => p.id === id)?.name ?? "";
  return (
    <section aria-label={t("documents.forPosting")} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("documents.forPosting")}</h2>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("documents.forPostingEmpty")}</p>
      ) : (
        documents.map((d) => (
          <div
            key={d.document.id}
            id={`doc-${d.document.id}`}
            className={focusId === d.document.id ? "rounded-lg ring-2 ring-primary" : undefined}
          >
            <DocumentPanel
              view={d}
              title={t("documents.of", {
                kind: t(`documents.kinds.${d.document.kind}` as TKey),
                target: name(d.document.profileId),
              })}
            />
          </div>
        ))
      )}
    </section>
  );
}
