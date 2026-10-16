import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useApi } from "../../app/context";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { type TKey, t } from "../../i18n";

/**
 * Configurações › Modelos de currículo (F05 §4, M7): os três padrão e os enviados; enviar .zip (validação no worker,
 * com os motivos quando inválido), prévia do CV de exemplo e apagar. Enquanto algum valida, a lista se atualiza.
 */
export const cvTemplatesKey = ["cv-templates"] as const;

export function CvTemplatesSection() {
  const api = useApi();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const list = useQuery({
    queryKey: cvTemplatesKey,
    queryFn: () => api.listCvTemplates(),
    refetchInterval: (q) =>
      q.state.data?.templates.some((x) => x.status === "validating") ? 2000 : false,
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadCvTemplate(file),
    onSettled: () => qc.invalidateQueries({ queryKey: cvTemplatesKey }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCvTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: cvTemplatesKey }),
  });
  return (
    <Card className="flex flex-col gap-3" aria-label={t("cvTemplates.title")}>
      <h3 className="text-sm font-semibold">{t("cvTemplates.title")}</h3>
      <p className="text-sm text-muted-fg">{t("cvTemplates.hint")}</p>
      <ul className="flex flex-col gap-2">
        {(list.data?.templates ?? []).map((tp) => (
          <li
            key={tp.id}
            className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{tp.name}</span>
              {tp.origin === "builtin" ? (
                <Badge>{t("cvTemplates.builtin")}</Badge>
              ) : (
                <Badge
                  tone={tp.status === "valid" ? "ok" : tp.status === "invalid" ? "danger" : "info"}
                >
                  {t(`cvTemplates.status.${tp.status}` as TKey)}
                </Badge>
              )}
              {tp.origin === "user" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    window.confirm(t("cvTemplates.removeConfirm")) && remove.mutate(tp.id)
                  }
                >
                  {t("cvTemplates.remove")}
                </Button>
              ) : null}
            </div>
            {tp.status === "invalid" && tp.validationErrors.length ? (
              <Alert tone="danger">
                <ul className="list-disc pl-5">
                  {tp.validationErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {tp.hasPreview ? (
              <img
                src={api.cvTemplatePreviewUrl(tp.id)}
                alt={t("cvTemplates.preview", { name: tp.name })}
                className="w-48 rounded border border-border bg-white"
              />
            ) : null}
          </li>
        ))}
      </ul>
      {upload.isError ? <Alert tone="danger">{(upload.error as Error).message}</Alert> : null}
      <div>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-label={t("cvTemplates.upload")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {t("cvTemplates.upload")}
        </Button>
      </div>
    </Card>
  );
}
