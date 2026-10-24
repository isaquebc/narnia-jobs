import type { ChatSession } from "@narnia-jobs/shared";
import { Link } from "@tanstack/react-router";
import { useTimezone } from "../../app/context";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { type TKey, t } from "../../i18n";
import { ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";

export interface SessionLimit {
  max: number;
  live: ChatSession[];
}

/** Lê o 409 `session_limit` (F04-3): devolve as conversas vivas para a UI perguntar qual encerrar. */
export function sessionLimitOf(e: unknown): SessionLimit | null {
  if (!(e instanceof ApiError) || e.code !== "session_limit") return null;
  const d = e.details as Partial<SessionLimit> | undefined;
  return { max: d?.max ?? 5, live: d?.live ?? [] };
}

/** Diálogo do teto de conversas (F04-3), usado ao criar conversa no chat e ao clarificar uma ingestão. */
export function SessionLimitDialog({
  limit,
  onChoose,
  onCancel,
}: {
  limit: SessionLimit | null;
  onChoose: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const tz = useTimezone();
  return (
    <Dialog
      open={limit !== null}
      onOpenChange={(o) => !o && onCancel()}
      title={t("chat.limitDialog", { max: limit?.max ?? 5 })}
    >
      <ul className="flex flex-col gap-2">
        {(limit?.live ?? []).map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{s.title}</span>
              <span className="text-xs text-muted-fg">
                {t(`chat.category.${s.category}` as TKey)} ·{" "}
                {t("chat.lastActivity", { date: formatDate(s.lastActivityAt, tz) })}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              aria-label={t("chat.limitClose", { title: s.title })}
              onClick={() => onChoose(s.id)}
            >
              {t("chat.close")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Link
          to="/configuracoes"
          hash="chat-max-live"
          className="text-sm text-primary underline-offset-2 hover:underline"
          onClick={onCancel}
        >
          {t("chat.limitSettings")}
        </Link>
        <Button variant="outline" onClick={onCancel}>
          {t("chat.cancel")}
        </Button>
      </div>
    </Dialog>
  );
}
