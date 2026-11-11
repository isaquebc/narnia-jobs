import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../../app/context";
import { Switch } from "../../components/ui/switch";
import { type TKey, t } from "../../i18n";

const key = ["mail", "stage-learning"] as const;

/**
 * Movimento de etapa pelo e-mail (F14-2): taxa de acerto das decisões e a chave do automático. O automático só age
 * com 20 decisões, 95 % de acerto na faixa de confiança alta e sem desfazer recente; até lá, o e-mail só sugere.
 */
export function MailStageLearning() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => api.getStageLearning() });
  const put = useMutation({
    mutationFn: (allowed: boolean) => api.putStageLearning(allowed),
    onSuccess: (v) => qc.setQueryData(key, v),
  });
  const l = q.data;
  if (!l) return null;
  return (
    <section aria-label={t("integrations.gmail.learning.title")} className="flex flex-col gap-1">
      <h4 className="text-sm font-medium">{t("integrations.gmail.learning.title")}</h4>
      <p className="text-xs text-muted-fg">{t("integrations.gmail.learning.hint")}</p>
      <p className="text-sm">
        {l.accuracy === null
          ? t("integrations.gmail.learning.noData")
          : t("integrations.gmail.learning.rate", {
              rate: Math.round(l.accuracy * 100),
              n: l.decisions,
            })}
      </p>
      <p className="text-xs">
        {l.active
          ? t("integrations.gmail.learning.active")
          : t("integrations.gmail.learning.inactive", {
              reason: t(`integrations.gmail.learning.reason.${l.reason ?? "off"}` as TKey, {
                n: l.decisions,
                min: l.minDecisions,
                rate: Math.round(l.minAccuracy * 100),
              }),
            })}
      </p>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          checked={l.allowed}
          onCheckedChange={(v) => put.mutate(v)}
          label={t("integrations.gmail.learning.allow")}
        />
        <span>{t("integrations.gmail.learning.allow")}</span>
      </div>
    </section>
  );
}
