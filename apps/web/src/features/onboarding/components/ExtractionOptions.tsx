import { Switch } from "../../../components/ui/switch";
import { t } from "../../../i18n";

export interface ExtractionOptionsValue {
  ocr: boolean;
  modelRead: boolean;
}

export function ExtractionOptions({
  isPdf,
  value,
  onChange,
}: {
  isPdf: boolean;
  value: ExtractionOptionsValue;
  onChange: (v: ExtractionOptionsValue) => void;
}) {
  if (!isPdf) return null;
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{t("source.options.title")}</legend>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm">{t("source.options.ocr")}</p>
          <p className="text-xs text-muted-fg">{t("source.options.ocrHint")}</p>
        </div>
        <Switch
          label={t("source.options.ocr")}
          checked={value.ocr}
          onCheckedChange={(ocr) => onChange({ ...value, ocr })}
        />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm">{t("source.options.modelRead")}</p>
          <p className="text-xs text-muted-fg">{t("source.options.modelReadHint")}</p>
        </div>
        <Switch
          label={t("source.options.modelRead")}
          checked={value.modelRead}
          onCheckedChange={(modelRead) => onChange({ ...value, modelRead })}
        />
      </div>
    </fieldset>
  );
}
