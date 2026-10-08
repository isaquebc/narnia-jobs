import type { FileDigest } from "@narnia-jobs/shared";
import { Card, CardTitle } from "../../../components/ui/card";
import { t } from "../../../i18n";

export function FileDigestCard({ digest }: { digest: FileDigest }) {
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t("extraction.digest.title")}</CardTitle>
      <p className="text-sm">{digest.summary}</p>
      <div className="flex gap-3 text-xs text-muted-fg">
        {digest.meta.pages ? (
          <span>{t("extraction.digest.pages", { count: digest.meta.pages })}</span>
        ) : null}
        {digest.meta.language ? (
          <span>{t("extraction.digest.language", { lang: digest.meta.language })}</span>
        ) : null}
      </div>
      {digest.keyPoints.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-fg">
            {t("extraction.digest.keyPoints")}
          </h4>
          <ul className="list-disc pl-5 text-sm">
            {digest.keyPoints.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {digest.sections.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-fg">
            {t("extraction.digest.sections")}
          </h4>
          <p className="text-sm text-muted-fg">{digest.sections.map((s) => s.title).join(" · ")}</p>
        </div>
      ) : null}
    </Card>
  );
}
