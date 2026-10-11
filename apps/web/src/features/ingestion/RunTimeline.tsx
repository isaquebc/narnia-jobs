import type { TimelineDto } from "@narnia-jobs/shared";
import { Badge } from "../../components/ui/badge";
import { type TKey, t } from "../../i18n";
import { FriendlyError } from "./FriendlyError";
import { stepKey } from "./runHeadline";

const TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "info"> = {
  pending: "neutral",
  running: "info",
  done: "ok",
  skipped: "neutral",
  error: "danger",
  stuck: "warn",
};

const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));

/** Etapas reais da execução, na ordem (plano de comunicação C1): estado, progresso, duração e último sinal. */
export function RunTimeline({
  timeline,
  now = Date.now(),
}: {
  timeline: TimelineDto;
  now?: number;
}) {
  return (
    <ol aria-label={t("timeline.title")} className="flex flex-col gap-2">
      {timeline.steps.map((s, i) => {
        const isCurrent = timeline.current === i + 1;
        return (
          <li
            key={s.key}
            aria-current={isCurrent ? "step" : undefined}
            className={`flex flex-col gap-1 rounded-md border p-2 text-sm ${isCurrent ? "border-primary" : "border-border"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                <span aria-hidden="true">{i + 1}. </span>
                <span>{t(stepKey(s.key))}</span>
              </span>
              <div className="flex items-center gap-2">
                {s.progress ? (
                  <span className="text-xs text-muted-fg">
                    {t("timeline.progress", { done: s.progress.done, total: s.progress.total })}
                  </span>
                ) : null}
                {s.failures ? (
                  <span className="text-xs text-danger">
                    {t("timeline.failures", { count: s.failures })}
                  </span>
                ) : null}
                <Badge tone={TONE[s.state] ?? "neutral"}>
                  {t(`timeline.state.${s.state}` as TKey)}
                </Badge>
              </div>
            </div>
            {s.state === "done" && typeof s.durationMs === "number" ? (
              <span className="text-xs text-muted-fg">
                {t("timeline.duration", { seconds: seconds(s.durationMs) })}
              </span>
            ) : null}
            {(s.state === "running" || s.state === "stuck") && s.lastActivityAt ? (
              <span className="text-xs text-muted-fg">
                {t("timeline.lastActivity", {
                  seconds: seconds(now - Date.parse(s.lastActivityAt)),
                })}
              </span>
            ) : null}
            {s.state === "error" && s.error ? <FriendlyError error={s.error} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
