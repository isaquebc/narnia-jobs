import { useState } from "react";
import { useChatSessions } from "../../hooks/useChat";
import { t } from "../../i18n";
import { NavLink } from "./NavLink";

/** Conversas recentes no menu (sempre visíveis, além das ativas); o resto aparece ao expandir. */
export const RECENT_CHATS = 5;

const sub =
  "flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-fg hover:bg-muted hover:text-fg [&.active]:bg-muted [&.active]:font-medium [&.active]:text-fg";

/**
 * Subitens do Chat no menu (pedido do dono, 2026-10-13): as 5 conversas mais recentes e todas as ativas; "Ver todas"
 * expande o resto. Ponto verde antes do nome quando há mensagem do recrutador ainda não vista.
 */
export function ChatNav({ profileId }: { profileId: string | null }) {
  const { sessions } = useChatSessions(profileId);
  const [expanded, setExpanded] = useState(false);
  if (sessions.length === 0) return null;
  const shown = expanded
    ? sessions
    : sessions.filter((s, i) => i < RECENT_CHATS || s.state === "live");
  const hidden = sessions.length - shown.length;
  return (
    <ul aria-label={t("nav.chatSessions")} className="ml-6 mt-1 flex flex-col gap-0.5">
      {shown.map((s) => (
        <li key={s.id}>
          <NavLink to={`/chat/${s.id}`} className={sub}>
            {(s.unread ?? 0) > 0 ? (
              <span
                role="img"
                aria-label={t("nav.chatUnread")}
                className="size-2 shrink-0 rounded-full bg-ok"
              />
            ) : (
              <span aria-hidden className="size-2 shrink-0" />
            )}
            <span className="truncate">{s.title}</span>
          </NavLink>
        </li>
      ))}
      {hidden > 0 || expanded ? (
        <li>
          <button
            type="button"
            className="px-2 py-1 text-xs text-muted-fg underline hover:text-fg"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t("nav.chatLess") : t("nav.chatMore", { count: sessions.length })}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** Quantas conversas estão ativas (processo vivo), para o selo do item Chat. */
export function useLiveChats(profileId: string | null): number {
  const { sessions } = useChatSessions(profileId);
  return sessions.filter((s) => s.state === "live").length;
}
