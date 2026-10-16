import type { CoverLetterFormat, DocumentKind } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Select, Textarea } from "../../components/ui/input";
import { documentKeys } from "../../hooks/useDocuments";
import { type TKey, t } from "../../i18n";
import { ApiError, type GenerateDocumentBody } from "../../lib/api";

/**
 * "Gerar" (F05-17, F05-21, F05-22): perfil (o recomendado pela análise por padrão), "gerar a carta junto" no CV da
 * vaga, formato da carta, instruções. Vaga num idioma que o currículo não cobre (F05-16): pergunta antes, e a pessoa
 * continua ou para.
 */
export function GenerateDialog({
  open,
  onOpenChange,
  kind,
  postingId,
  profiles,
  defaultProfileId,
  recommendedProfileId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: DocumentKind;
  postingId: string | null;
  profiles: Array<{ id: string; name: string }>;
  defaultProfileId: string | null;
  recommendedProfileId?: string | null;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [profileId, setProfileId] = useState(defaultProfileId ?? profiles[0]?.id ?? "");
  const [withLetter, setWithLetter] = useState(false);
  const [format, setFormat] = useState<CoverLetterFormat>("pdf");
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState<{ message: string } | null>(null);
  const ids = useId();
  const run = useMutation({
    mutationFn: (acceptLanguage: boolean) => {
      const body: GenerateDocumentBody = {
        kind,
        profileId,
        postingId,
        instructions: instructions.trim() || null,
        ...(acceptLanguage ? { acceptLanguage } : {}),
        ...(kind === "cover_letter" || withLetter ? { format } : {}),
        ...(kind === "cv" && postingId && withLetter ? { withCoverLetter: true } : {}),
      };
      return api.generateDocument(body);
    },
    onSuccess: async () => {
      setLanguage(null);
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: documentKeys.all });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "language_not_covered")
        setLanguage({ message: e.message });
    },
  });
  const showFormat = kind === "cover_letter" || withLetter;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`documents.generateTitle.${kind}` as TKey)}
    >
      {language ? (
        <div
          className="flex flex-col gap-3"
          role="alertdialog"
          aria-label={t("documents.languageTitle")}
        >
          <Alert tone="warn">{language.message}</Alert>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setLanguage(null);
                onOpenChange(false);
              }}
            >
              {t("documents.stop")}
            </Button>
            <Button type="button" disabled={run.isPending} onClick={() => run.mutate(true)}>
              {t("documents.continueAnyway")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate(false);
          }}
        >
          {profiles.length > 1 || postingId ? (
            <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-profile`}>
              {t("documents.profile")}
              <Select
                id={`${ids}-profile`}
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === recommendedProfileId
                      ? t("documents.recommended", { name: p.name })
                      : p.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {kind === "cv" && postingId ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withLetter}
                onChange={(e) => setWithLetter(e.target.checked)}
              />
              {t("documents.withLetter")}
            </label>
          ) : null}
          {showFormat ? (
            <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-format`}>
              {t("documents.format")}
              <Select
                id={`${ids}-format`}
                value={format}
                onChange={(e) => setFormat(e.target.value as CoverLetterFormat)}
              >
                <option value="pdf">{t("documents.formats.pdf")}</option>
                <option value="text">{t("documents.formats.text")}</option>
              </Select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${ids}-instructions`}>
            {t("documents.instructions")}
            <Textarea
              id={`${ids}-instructions`}
              className="min-h-24"
              placeholder={t("documents.instructionsHint")}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
          {run.isError && !language ? (
            <Alert tone="danger">{(run.error as Error).message}</Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("documents.cancel")}
            </Button>
            <Button type="submit" disabled={run.isPending || !profileId}>
              {t("documents.submit")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
