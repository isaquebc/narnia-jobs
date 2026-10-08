import { AlertTriangle } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { type TKey, t } from "../../../i18n";

export type Origin = "text_layer" | "ocr" | "model_read" | "consolidated";

export function ReadingOriginBadge({
  origin,
  divergent = false,
}: {
  origin: Origin | null;
  divergent?: boolean | undefined;
}) {
  if (!origin) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={origin === "consolidated" ? "neutral" : "info"}>
        {t(`review.origin.${origin}` as TKey)}
      </Badge>
      {divergent ? (
        <span title={t("review.origin.divergences")} className="text-warn">
          <AlertTriangle size={14} aria-hidden />
        </span>
      ) : null}
    </span>
  );
}
