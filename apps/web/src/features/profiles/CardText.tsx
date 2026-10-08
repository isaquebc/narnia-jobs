import { t } from "../../i18n";
import { cn } from "../../lib/cn";

const SUMMARY_PREFIX = "Resumo objetivo";

/** Texto do cartão linha a linha; a linha do resumo objetivo (F02-2) vem destacada. */
export function CardText({
  text,
  lines,
  className,
}: {
  text: string;
  lines?: number;
  className?: string;
}) {
  const all = text.split("\n");
  const shown = lines ? all.slice(0, lines) : all;
  return (
    <div className={cn("flex flex-col gap-0.5 font-mono text-xs", className)}>
      {shown.map((line, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: linhas do cartão não têm id; a ordem é o id
          key={i}
          className={cn(
            line.startsWith(SUMMARY_PREFIX) && "rounded bg-primary/10 px-1 font-semibold",
          )}
          title={line.startsWith(SUMMARY_PREFIX) ? t("card.summary") : undefined}
        >
          {line || " "}
        </p>
      ))}
    </div>
  );
}
