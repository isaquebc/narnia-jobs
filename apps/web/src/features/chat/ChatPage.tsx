import type { ChatSession } from "@narnia-jobs/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, Pencil, Square, Wrench } from "lucide-react";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApi, useTimezone, useWs } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Input, Select, Textarea } from "../../components/ui/input";
import {
  chatKeys,
  type LiveTool,
  useChatSession,
  useChatSessions,
  useResearch,
  useSessionCard,
} from "../../hooks/useChat";
import { ingestionKey } from "../../hooks/useIngestion";
import { useProfiles } from "../../hooks/useProfiles";
import { useProviderStatus } from "../../hooks/useProviderStatus";
import { type TKey, t } from "../../i18n";
import { formatDate, formatTokens } from "../../lib/format";
import { FriendlyError } from "../ingestion/FriendlyError";
import { Markdown } from "./Markdown";
import { type SessionLimit, SessionLimitDialog, sessionLimitOf } from "./SessionLimitDialog";

const MODELS = ["sonnet", "haiku", "opus"];

/** Chat com o recrutador (F04 §4): conversas do perfil ativo, mensagens em stream, contexto e teto de conversas. */
export function ChatPage({ sessionId }: { sessionId?: string }) {
  const { active } = useProfiles();
  const provider = useProviderStatus();
  const loggedIn = provider.data?.loggedIn !== false;
  const { sessions, create, hibernate, patch } = useChatSessions(active?.id ?? null);
  const navigate = useNavigate();
  const [limit, setLimit] = useState<SessionLimit | null>(null);

  const visible = sessions.filter((s) => s.state !== "archived");
  useEffect(() => {
    if (!sessionId && visible[0]) void navigate({ to: `/chat/${visible[0].id}` as string });
  }, [sessionId, visible, navigate]);
  // trocou o perfil ativo com uma conversa de outro perfil aberta: vai para as conversas do perfil novo (auditoria D)
  const api = useApi();
  const open = useQuery({
    queryKey: chatKeys.session(sessionId ?? ""),
    queryFn: () => api.getChatSession(sessionId as string),
    enabled: Boolean(sessionId),
  });
  const openProfile = open.data?.session.profileId;
  const activeId = active?.id ?? null;
  const prevActive = useRef(activeId);
  useEffect(() => {
    const switched = prevActive.current !== null && prevActive.current !== activeId;
    prevActive.current = activeId;
    // só na troca: abrir pela URL uma conversa de outro perfil continua possível (o painel mostra o perfil dela)
    if (switched && sessionId && activeId && openProfile && openProfile !== activeId)
      void navigate({ to: "/chat" });
  }, [sessionId, activeId, openProfile, navigate]);

  const startNew = async () => {
    try {
      const r = await create.mutateAsync({});
      void navigate({ to: `/chat/${r.session.id}` as string });
    } catch (e) {
      const l = sessionLimitOf(e);
      if (l) setLimit(l);
    }
  };
  const closeAndCreate = async (id: string) => {
    await hibernate.mutateAsync(id);
    setLimit(null);
    await startNew();
  };

  return (
    // altura fixa (a do <main>): as mensagens rolam dentro do próprio quadro e o envio fica sempre à vista
    <div className="flex h-full min-h-0 gap-4">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{t("chat.title")}</h1>
          <Button onClick={() => void startNew()} disabled={!loggedIn || create.isPending}>
            {t("chat.newSession")}
          </Button>
        </div>
        {!loggedIn ? (
          <Alert tone="warn">
            {t("chat.loggedOut", { hint: provider.data?.loginHint ?? t("chat.loggedOutDefault") })}
          </Alert>
        ) : null}
        <SessionTabs
          sessions={visible}
          current={sessionId ?? null}
          onRename={(id, title) => patch.mutate({ id, title })}
          onArchive={(id) => patch.mutate({ id, archived: true })}
        />
        {sessionId ? (
          <ChatView key={sessionId} sessionId={sessionId} />
        ) : (
          <p className="text-sm text-muted-fg">{t("chat.empty")}</p>
        )}
      </div>
      {sessionId ? <ContextPanel key={sessionId} sessionId={sessionId} /> : null}
      <SessionLimitDialog
        limit={limit}
        onChoose={(id) => void closeAndCreate(id)}
        onCancel={() => setLimit(null)}
      />
    </div>
  );
}

function SessionTabs({
  sessions,
  current,
  onRename,
  onArchive,
}: {
  sessions: ChatSession[];
  current: string | null;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  if (sessions.length === 0) return null;
  return (
    <nav aria-label={t("chat.sessions")} className="flex flex-wrap gap-2">
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${s.id === current ? "border-primary bg-muted" : "border-border"}`}
        >
          {editing === s.id ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (title.trim()) onRename(s.id, title.trim());
                setEditing(null);
              }}
            >
              <Input
                aria-label={t("chat.renameLabel")}
                value={title}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditing(null)}
                className="h-7"
              />
            </form>
          ) : (
            <NavLink to={`/chat/${s.id}`} className="flex items-center gap-1">
              <span>{s.title}</span>
              <Badge tone={s.state === "live" ? "ok" : "neutral"}>
                {t(`chat.state.${s.state}` as TKey)}
              </Badge>
            </NavLink>
          )}
          {s.id === current ? (
            <>
              <button
                type="button"
                aria-label={t("chat.rename")}
                className="text-muted-fg hover:text-fg"
                onClick={() => {
                  setTitle(s.title);
                  setEditing(s.id);
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                aria-label={t("chat.archive")}
                className="text-muted-fg hover:text-fg"
                onClick={() => onArchive(s.id)}
              >
                <Archive size={14} />
              </button>
            </>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

function ToolChip({
  tool,
}: {
  tool: { name: string; durationMs?: number | null | undefined; isError?: boolean };
}) {
  return (
    <details className="inline-block rounded-md border border-border px-2 py-0.5 text-xs">
      <summary className="flex cursor-pointer items-center gap-1">
        <Wrench size={12} />
        <span>{tool.name}</span>
      </summary>
      <span className="text-muted-fg">
        {tool.isError
          ? t("chat.toolError")
          : tool.durationMs != null
            ? t("chat.toolDuration", { ms: tool.durationMs })
            : t("chat.thinking")}
      </span>
    </details>
  );
}

function ChatView({ sessionId }: { sessionId: string }) {
  const chat = useChatSession(sessionId);
  const api = useApi();
  const [text, setText] = useState("");
  // teto de conversas ao enviar numa conversa hibernada (F04-3): pergunta qual encerrar e reenvia a mensagem
  const [limit, setLimit] = useState<(SessionLimit & { text: string }) | null>(null);
  const s = chat.session;
  const sendText = (v: string) =>
    chat.send.mutate(v, {
      onError: (e) => {
        setText(v); // a mensagem não foi: volta para o campo
        const l = sessionLimitOf(e);
        if (l) setLimit({ ...l, text: v });
      },
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || chat.turnActive) return;
    sendText(v);
    setText("");
  };
  const closeAndResend = async (id: string) => {
    const pending = limit?.text ?? "";
    setLimit(null);
    await api.hibernateChat(id);
    setText("");
    sendText(pending);
  };
  const sessionTokens = (s?.tokensIn ?? 0) + (s?.tokensOut ?? 0);
  // desce sozinho a cada mensagem nova, a menos que o usuário tenha subido para ler o histórico
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const historyLength = chat.history.length;
  const toolsLength = chat.tools.length;
  // "Carregar anteriores": mantém na tela a mensagem que estava no topo (compensa a altura acrescentada em cima)
  const prevHeight = useRef<number | null>(null);
  const loadOlder = () => {
    stuck.current = false;
    prevHeight.current = scroller.current?.scrollHeight ?? null;
    chat.loadOlder.mutate();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: as dependências são os gatilhos de rolagem, não lidas no efeito
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
      return;
    }
    if (stuck.current) el.scrollTop = el.scrollHeight;
  }, [historyLength, toolsLength, chat.streamed, chat.pendingUser, chat.turnActive]);
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3"
      aria-label={s?.title ?? t("chat.title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {s ? <Badge tone="neutral">{t(`chat.category.${s.category}` as TKey)}</Badge> : null}
          {s?.category === "clarify" && s.ingestionRunId ? (
            <ClarifyHeader runId={s.ingestionRunId} />
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={`chat-model-${sessionId}`}>{t("chat.model")}</label>
          <Select
            id={`chat-model-${sessionId}`}
            value={s?.model ?? "sonnet"}
            onChange={(e) => chat.setModel.mutate(e.target.value)}
            className="h-8 w-28"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {s?.state === "hibernated" ? <Alert tone="info">{t("chat.hibernated")}</Alert> : null}
      {s?.state === "error" ? <Alert tone="warn">{t("chat.errorState")}</Alert> : null}
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto pr-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {chat.hasOlder ? (
          <div className="mb-3 flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={chat.loadOlder.isPending}
              onClick={loadOlder}
            >
              {t("chat.loadOlder")}
            </Button>
          </div>
        ) : null}
        <ol className="flex flex-col gap-3" aria-label={t("chat.messages")}>
          {chat.history.length === 0 && !chat.pendingUser ? (
            <li className="text-sm text-muted-fg">{t("chat.emptySession")}</li>
          ) : null}
          {chat.history.map((m) => (
            <li key={m.id} className={m.role === "user" ? "self-end max-w-[80%]" : "max-w-[90%]"}>
              {m.role === "system_note" ? (
                <p className="text-xs italic text-muted-fg">{m.contentMd}</p>
              ) : (
                <Card className={m.role === "user" ? "bg-muted p-3" : "p-3"}>
                  <span className="mb-1 block text-xs text-muted-fg">
                    {m.role === "user" ? t("chat.you") : t("chat.recruiter")}
                  </span>
                  {m.toolCalls.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {m.toolCalls.map((tc, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: lista do histórico, imutável e sem reordenação
                        <ToolChip key={`${m.id}-${i}`} tool={tc} />
                      ))}
                    </div>
                  ) : null}
                  <Markdown text={m.contentMd} />
                </Card>
              )}
            </li>
          ))}
          {chat.pendingUser ? (
            <li className="self-end max-w-[80%]">
              <Card className="bg-muted p-3">
                <span className="mb-1 block text-xs text-muted-fg">{t("chat.you")}</span>
                <Markdown text={chat.pendingUser} />
              </Card>
            </li>
          ) : null}
          {chat.turnActive || chat.streamed || chat.tools.length > 0 ? (
            <li className="max-w-[90%]" aria-live="polite">
              <Card className="p-3">
                <span className="mb-1 block text-xs text-muted-fg">{t("chat.recruiter")}</span>
                {chat.tools.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {chat.tools.map((tl: LiveTool, i) => (
                      <ToolChip
                        // biome-ignore lint/suspicious/noArrayIndexKey: ferramentas do turno só são acrescentadas, nunca reordenadas
                        key={`${tl.name}-${i}`}
                        tool={{
                          name: tl.name,
                          durationMs: tl.durationMs,
                          isError: tl.phase === "error",
                        }}
                      />
                    ))}
                  </div>
                ) : null}
                {chat.streamed ? <Markdown text={chat.streamed} /> : null}
                {chat.turnActive && !chat.streamed ? (
                  <span className="text-sm text-muted-fg">{t("chat.thinking")}</span>
                ) : null}
              </Card>
            </li>
          ) : null}
        </ol>
      </div>
      {chat.createdRuns.map((runId) => (
        <NavLink key={runId} to={`/ingestao/${runId}`} className="text-sm underline">
          {t("chat.ingestionCreated")}
        </NavLink>
      ))}
      {chat.error ? (
        <Alert tone="danger">
          <FriendlyError
            error={{
              key: (chat.error.key ?? "error.unknown") as never,
              hint: `${chat.error.key ?? "error.unknown"}_hint` as never,
              technical: chat.error.technical,
            }}
          />
        </Alert>
      ) : null}
      {chat.limit ? (
        <Alert tone="warn">
          {chat.limit === "max_turns" ? t("chat.limitTurns") : t("chat.limitBudget")}
        </Alert>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Textarea
          aria-label={t("chat.inputLabel")}
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e as unknown as FormEvent);
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span data-testid="session-usage" className="text-xs text-muted-fg">
            {t("chat.usage", {
              turn: formatTokens(chat.lastUsage ?? 0),
              session: formatTokens(sessionTokens),
            })}
          </span>
          <div className="flex gap-2">
            {chat.turnActive ? (
              <Button type="button" variant="outline" onClick={() => chat.interrupt.mutate()}>
                <Square size={14} /> {t("chat.stop")}
              </Button>
            ) : null}
            <Button type="submit" disabled={chat.turnActive || !text.trim()}>
              {t("chat.send")}
            </Button>
          </div>
        </div>
      </form>
      <SessionLimitDialog
        limit={limit}
        onChoose={(id) => void closeAndResend(id)}
        onCancel={() => setLimit(null)}
      />
    </section>
  );
}

function ClarifyHeader({ runId }: { runId: string }) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const run = useQuery({
    queryKey: ["ingestion", runId, "clarify"],
    queryFn: () => api.getIngestion(runId),
  });
  useEffect(
    () =>
      ws.subscribe((e) => {
        if (e.type === "ingestion.updated" && e.runId === runId) {
          void qc.invalidateQueries({ queryKey: ["ingestion", runId, "clarify"] });
          // a página da execução está desmontada enquanto o usuário conversa: marca a revisão como velha para
          // "Ir para a revisão" trazer as propostas novas (regressão do e2e F04/E2E-06)
          void qc.invalidateQueries({ queryKey: ingestionKey(runId) });
        }
      }),
    [ws, qc, runId],
  );
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-medium">{t("chat.clarifying", { id: runId.slice(0, 8) })}</span>
      <span className="text-muted-fg">
        {t("chat.clarifyProposals", { count: run.data?.proposals?.length ?? 0 })}
      </span>
      <NavLink to={`/ingestao/${runId}`} className="underline">
        {t("chat.goToReview")}
      </NavLink>
    </div>
  );
}

function ContextPanel({ sessionId }: { sessionId: string }) {
  const chat = useChatSession(sessionId);
  const profileId = chat.session?.profileId ?? null;
  const card = useSessionCard(profileId);
  const sources = useResearch(profileId);
  const tz = useTimezone();
  const used = Array.from(
    new Set([
      ...chat.history.flatMap((m) => m.toolCalls.map((tc) => tc.name)),
      ...chat.tools.map((tl) => tl.name),
    ]),
  );
  const mine = sources.filter((s) => s.sessionId === null || s.sessionId === sessionId);
  return (
    <aside
      aria-label={t("chat.context")}
      className="hidden min-h-0 w-72 shrink-0 flex-col gap-3 overflow-y-auto lg:flex"
    >
      <Card className="p-3">
        <CardTitle className="mb-2 text-sm">{t("chat.card")}</CardTitle>
        <p className="whitespace-pre-wrap text-xs text-muted-fg">{card.data?.text ?? "…"}</p>
      </Card>
      <Card className="p-3">
        <CardTitle className="mb-2 text-sm">{t("chat.toolsUsed")}</CardTitle>
        {used.length === 0 ? (
          <p className="text-xs text-muted-fg">{t("chat.noTools")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {used.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-3">
        <CardTitle className="mb-2 text-sm">{t("chat.sources")}</CardTitle>
        {mine.length === 0 ? (
          <p className="text-xs text-muted-fg">{t("chat.noSources")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-xs">
            {mine.map((src) => (
              <li key={src.id} className="flex flex-col">
                <a href={src.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {src.title}
                </a>
                <span className="text-muted-fg">
                  {t("chat.sourceMeta", {
                    domain: src.domain,
                    date: formatDate(src.accessedAt, tz),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </aside>
  );
}
