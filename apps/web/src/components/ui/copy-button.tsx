import { useState } from "react";
import { t } from "../../i18n";
import { Button } from "./button";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard indisponível
        }
      }}
    >
      {copied ? t("app.copied") : t("app.copy")}
    </Button>
  );
}
