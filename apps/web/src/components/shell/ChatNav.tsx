import type { ChatCategory, ChatSession } from "@narnia-jobs/shared";
import { useState } from "react";
import { useChatSessions } from "../../hooks/useChat";
import { type TKey, t } from "../../i18n";
import { NavLink } from "./NavLink";

/** Conversas recentes no menu (sempre visíveis, além das ativas); o resto aparece ao expandir. */
export const RECENT_CHATS = 5;

const sub =
  "flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-fg hover:bg-muted hover:text-fg [&.active]:bg-muted [&.active]:font-medium [&.active]:text-fg";

/**
 * Subitens do Chat no menu (pedido do dono, 2026-10-13): as 5 conversas mais recentes e todas as ativas; "Ver todas"
 * expande o resto. Ponto verde antes do nome quando há mensagem do recrutador ainda não vista. Recrutador global
 * (F06-8): as conversas são de todos os perfis, agrupadas por tema (categoria) quando há mais de um.
 */
export function ChatNav({ enabled = true }: { enabled?: boolean }) {
  const { sessions } = useChatSessions(enabled);
  const [expanded, setExpanded] = useState(false);
  if (sessions.length === 0) return null;
  const shown = expanded
    ? sessions
    : sessions.filter((s, i) => i < RECENT_CHATS || s.state === "live");
  const hidden = sessions.length - shown.length;
  const groups = groupByCategory(shown);
  return (
    <ul aria-label={t("nav.chatSessions")} className="ml-6 mt-1 flex flex-col gap-0.5">
      {groups.length === 1
        ? (groups[0]?.sessions ?? []).map((s) => <SessionItem key={s.id} session={s} />)
        : groups.map((g) => (
            <li key={g.category}>
              <span className="block px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-fg">
                {t(`chat.category.${g.category}` as TKey)}
              </span>
              <ul
                aria-label={t(`chat.category.${g.category}` as TKey)}
                className="flex flex-col gap-0.5"
              >
                {g.sessions.map((s) => (
                  <SessionItem key={s.id} session={s} />
                ))}
              </ul>
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

function SessionItem({ session: s }: { session: ChatSession }) {
  return (
    <li>
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
  );
}

/** Grupos na ordem da conversa mais recente de cada categoria (a lista já vem da mais recente para a mais antiga). */
export function groupByCategory(
  sessions: ChatSession[],
): Array<{ category: ChatCategory; sessions: ChatSession[] }> {
  const groups = new Map<ChatCategory, ChatSession[]>();
  for (const s of sessions) {
    const list = groups.get(s.category) ?? [];
    list.push(s);
    groups.set(s.category, list);
  }
  return [...groups].map(([category, list]) => ({ category, sessions: list }));
}

/** Quantas conversas estão ativas (processo vivo), para o selo do item Chat. */
export function useLiveChats(enabled = true): number {
  const { sessions } = useChatSessions(enabled);
  return sessions.filter((s) => s.state === "live").length;
}
