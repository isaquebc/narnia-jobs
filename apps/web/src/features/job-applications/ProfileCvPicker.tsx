import type { JobApplicationSummary } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "../../app/context";
import { describeError } from "../../components/ErrorState";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/input";
import { jobApplicationKeys } from "../../hooks/useJobApplications";
import { t } from "../../i18n";

/**
 * Perfil e CV da candidatura vinda de e-mail (F14-5, F14-15): trocar o perfil escolhido pelo narnia e ligar a versão do
 * CV que foi enviada (as versões prontas do perfil), ou tirar o CV. Arquivo feito fora do narnia vai numa nota.
 */
export function ProfileCvPicker({ application: a }: { application: JobApplicationSummary }) {
  const api = useApi();
  const qc = useQueryClient();
  const [profileId, setProfileId] = useState(a.profileId ?? "");
  const [cv, setCv] = useState(a.cv?.versionId ?? "");
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => api.listProfiles() });
  const docs = useQuery({
    queryKey: ["documents", { profileId }],
    queryFn: () => api.listDocuments({ profileId }),
    enabled: !!profileId,
  });
  const versions = (docs.data?.documents ?? [])
    .filter((d) => d.document.kind === "cv")
    .flatMap((d) =>
      d.versions
        .filter((v) => v.status === "ready" || v.status === "ready_with_issues")
        .map((v) => ({
          id: v.id,
          label: t("jobApplications.fromMail.cvOption", {
            version: v.version,
            scope:
              d.document.postingId === a.postingId
                ? t("jobApplications.fromMail.cvForPosting")
                : d.document.postingId
                  ? t("jobApplications.fromMail.cvOtherPosting")
                  : t("jobApplications.fromMail.cvGeneral"),
          }),
        })),
    );
  const save = useMutation({
    mutationFn: () =>
      api.putJobApplicationProfileCv(a.id, {
        ...(profileId && profileId !== a.profileId ? { profileId } : {}),
        cvVersionId: cv || null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobApplicationKeys.all }),
  });
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("jobApplications.fromMail.profile")}
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value);
            setCv("");
          }}
          className="w-auto"
        >
          <option value="">{t("jobApplications.fromMail.chooseProfile")}</option>
          {(profiles.data?.profiles ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("jobApplications.fromMail.cv")}
          value={cv}
          onChange={(e) => setCv(e.target.value)}
          className="w-auto"
          disabled={!profileId}
        >
          <option value="">{t("jobApplications.fromMail.noCvOption")}</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={!profileId || save.isPending} onClick={() => save.mutate()}>
          {t("jobApplications.fromMail.save")}
        </Button>
      </div>
      <p className="text-xs text-muted-fg">{t("jobApplications.fromMail.attachHint")}</p>
      {save.isError ? <Alert tone="danger">{describeError(save.error).title}</Alert> : null}
    </div>
  );
}
