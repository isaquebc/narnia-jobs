import { Upload } from "lucide-react";
import { type DragEvent, useId, useState } from "react";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { t } from "../../../i18n";
import { cn } from "../../../lib/cn";
import { formatBytes } from "../../../lib/format";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPT = ".pdf,.docx,.md,.markdown,.txt";
const ALLOWED_EXT = /\.(pdf|docx|md|markdown|txt)$/i;

export function validateFile(file: File): string | null {
  if (!ALLOWED_EXT.test(file.name)) return t("source.invalidType");
  if (file.size > MAX_UPLOAD_BYTES) return t("source.tooLarge");
  return null;
}

export function FileDropzone({
  value,
  onChange,
}: {
  value: File | null;
  onChange: (f: File | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  function pick(file: File | undefined) {
    if (!file) return;
    const err = validateFile(file);
    setError(err);
    if (!err) onChange(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  }

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <span>{t("source.selected", { name: value.name, size: formatBytes(value.size) })}</span>
          <Button variant="outline" size="sm" onClick={() => onChange(null)}>
            {t("source.remove")}
          </Button>
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: zona de arrastar; o controle acessível é o input de arquivo
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center text-sm",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <Upload className="text-muted-fg" />
          <p>
            {t("source.dropzone")}{" "}
            <label htmlFor={inputId} className="cursor-pointer font-medium text-primary underline">
              {t("source.choose")}
            </label>
          </p>
          <p className="text-xs text-muted-fg">{t("source.accepted")}</p>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
