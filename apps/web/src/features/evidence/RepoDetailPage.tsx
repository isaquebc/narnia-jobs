import { t } from "../../i18n";

/** Detalhe do repositório (F03 §4): relatório, métricas, digest editável e reanalisar. */
export function RepoDetailPage({ repoId }: { repoId: string }) {
  return (
    <div className="flex flex-col gap-4" data-repo-id={repoId}>
      <h1 className="text-xl font-semibold">{t("evidence.title")}</h1>
    </div>
  );
}
