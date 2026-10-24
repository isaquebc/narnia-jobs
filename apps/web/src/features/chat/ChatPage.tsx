import type { ChatMessage, ChatSession, Profile } from "@narnia-jobs/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, Paperclip, Pencil, Square, Wrench } from "lucide-react";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApi, useTimezone, useWs } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Input, Select, Textarea } from "../../components/ui/input";
import {
  chatKeys,
  type LiveTool,
  useChatSession,
  useChatSessions,
  useChatSettings,
  useResearch,
  useSessionCard,
} from "../../hooks/useChat";
import { ingestionKey } from "../../hooks/useIngestion";
import { useProfiles } from "../../hooks/useProfiles";
import { useProviderStatus } from "../../hooks/useProviderStatus";
import { type TKey, t } from "../../i18n";
import { formatDate, formatTokens } from "../../lib/format";
import { FriendlyError } from "../ingestion/FriendlyError";
import { ACCEPT, validateFile } from "../onboarding/components/FileDropzone";
import { ChatIngestionCard } from "./ChatIngestionCard";
import { Markdown } from "./Markdown";
import { type SessionLimit, SessionLimitDialog, sessionLimitOf } from "./SessionLimitDialog";

const MODELS = ["sonnet", "haiku", "opus"];

/**
 * Anexo do composer (auditoria E1, §1.4): o arquivo sobe por `/api/files` e a mensagem leva este marcador para o
 * recrutador chamar `ingest_file`; a bolha mostra o anexo como chip.
 */
const ATTACHMENT = /^\[anexo: (.+?) · fileId ([^\]\s]+)\]\n?/;
export const attachmentMarker = (name: string, fileId: string) =>
  `[anexo: ${name.replace(/[[\]]/g, "")} · fileId ${fileId}]`;

const usd = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(v);

function UserContent({ text }: { text: string }) {
  const m = ATTACHMENT.exec(text);
  if (!m) return <Markdown text={text} />;
  const rest = text.slice(m[0].length).trim();
  return (
    <>
      <span className="mb-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
        <Paperclip size={12} />
        <span>{m[1]}</span>
      </span>
      {rest ? <Markdown text={rest} /> : null}
    </>
  );
}

/**
 * Nome do recrutador: o título da página é só "Recrutador" (recrutador global, pedido do dono em 2026-10-15) e o autor
 * das mensagens "Recrutador <perfil> <senioridade do recrutador>" (2026-10-13; Sênior por padrão, a persona pode trocar
 * para Pleno).
 */
export function recruiterNames(profile: Pick<Profile, "name" | "personaOverrides"> | null) {
  if (!profile) return { title: t("chat.title"), author: t("chat.recruiter") };
  const seniority = profile.personaOverrides?.recruiterSeniority ?? "senior";
  return {
    title: t("chat.title"),
    author: t("chat.recruiterName", {
      profile: profile.name,
      seniority: t(`chat.seniority.${seniority}` as TKey),
    }),
  };
}

function useRecruiterNames(profileId: string | null | undefined) {
  const { profiles, active } = useProfiles();
  return recruiterNames(profiles.find((p) => p.id === profileId) ?? (profileId ? null : active));
}

/** Chat com o recrutador (F04 §4): conversas do perfil ativo, mensagens em stream, contexto e teto de conversas. */
export function ChatPage({ sessionId }: { sessionId?: string }) {
  const { active } = useProfiles();
  const provider = useProviderStatus();
  const loggedIn = provider.data?.loggedIn !== false;
  const { sessions, create, hibernate, patch } = useChatSessions();
  const navigate = useNavigate();
  const [limit, setLimit] = useState<SessionLimit | null>(null);
  const names = useRecruiterNames(active?.id ?? null);

  const visible = sessions.filter((s) => s.state !== "archived");
  useEffect(() => {
    if (!sessionId && visible[0]) void navigate({ to: `/chat/${visible[0].id}` as string });
  }, [sessionId, visible, navigate]);
  // recrutador global (F06-8): trocar o perfil ativo não fecha a conversa aberta
  const api = useApi();
  const open = useQuery({
    queryKey: chatKeys.session(sessionId ?? ""),
    queryFn: () => api.getChatSession(sessionId as string),
    enabled: Boolean(sessionId),
  });

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
          <h1 className="text-xl font-semibold">{names.title}</h1>
          <Button onClick={() => void startNew()} disabled={!loggedIn || create.isPending}>
            {t("chat.newSession")}
          </Button>
        </div>
        {!loggedIn ? (
          <Alert tone="warn">
            {t("chat.loggedOut", { hint: provider.data?.loginHint ?? t("chat.loggedOutDefault") })}
          </Alert>
        ) : null}
        {/* a lista de conversas fica no menu da esquerda (2026-10-13); aqui só a aberta, com renomear e arquivar */}
        {open.data ? (
          <SessionHeader
            session={open.data.session}
            onRename={(title) => patch.mutate({ id: open.data.session.id, title })}
            onArchive={() => patch.mutate({ id: open.data.session.id, archived: true })}
          />
        ) : null}
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

function SessionHeader({
  session,
  onRename,
  onArchive,
}: {
  session: ChatSession;
  onRename: (title: string) => void;
  onArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <div className="flex items-center gap-2 text-sm">
      {editing ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (title.trim()) onRename(title.trim());
            setEditing(false);
          }}
        >
          <Input
            aria-label={t("chat.renameLabel")}
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setEditing(false)}
            className="h-7"
          />
        </form>
      ) : (
        <h2 className="truncate font-medium">{session.title}</h2>
      )}
      <Badge tone={session.state === "live" ? "ok" : "neutral"}>
        {t(`chat.state.${session.state}` as TKey)}
      </Badge>
      <button
        type="button"
        aria-label={t("chat.rename")}
        className="text-muted-fg hover:text-fg"
        onClick={() => {
          setTitle(session.title);
          setEditing(true);
        }}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        aria-label={t("chat.archive")}
        className="text-muted-fg hover:text-fg"
        onClick={onArchive}
      >
        <Archive size={14} />
      </button>
    </div>
  );
}

function ToolChip({
  tool,
}: {
  tool: {
    name: string;
    durationMs?: number | null | undefined;
    isError?: boolean;
    subagent?: boolean | undefined;
  };
}) {
  return (
    <details className="inline-block rounded-md border border-border px-2 py-0.5 text-xs">
      <summary className="flex cursor-pointer items-center gap-1">
        <Wrench size={12} />
        <span>{tool.name}</span>
        {/* chamada do recrutador especializado (F06-8) */}
        {tool.subagent ? <span className="text-muted-fg">· {t("chat.bySpecialist")}</span> : null}
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

/** Conversa aberta (L2); também usada dentro do wizard pela entrevista de descoberta (auditoria E2). */
/** `draft`: texto inicial do campo (janela do formulário, "Ajustar no chat"). */
export function ChatView({ sessionId, draft }: { sessionId: string; draft?: string }) {
  const chat = useChatSession(sessionId);
  const api = useApi();
  const names = useRecruiterNames(chat.session?.profileId);
  const [text, setText] = useState(draft ?? "");
  useEffect(() => {
    if (draft) setText(draft);
  }, [draft]);
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
  const budget = useChatSettings().settings?.maxBudgetUsd ?? null;
  // anexo (auditoria E1): mesmos tipos da ingestão; sobe e manda a mensagem com o marcador para o `ingest_file`
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attach = async (f: File) => {
    const invalid = validateFile(f);
    setAttachError(invalid);
    if (invalid) return;
    setUploading(f.name);
    try {
      const up = await api.uploadFile(f);
      const note = text.trim() || t("chat.attachDefault");
      setText("");
      sendText(`${attachmentMarker(f.name, up.id)}\n${note}`);
    } catch (e) {
      setAttachError((e as Error).message);
    } finally {
      setUploading(null);
    }
  };
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
  // ingestões do turno em andamento: as que o histórico ainda não tem vão com o link na bolha provisória
  const savedRuns = new Set(chat.history.flatMap(runsOf));
  const liveRuns = chat.createdRuns.filter((r) => !savedRuns.has(r));
  // lida só quando a última mensagem aparece na tela (2026-10-13): rolou para cima, escondendo-a, não marca
  const lastSeen = useRef<HTMLLIElement>(null);
  const last = chat.history.at(-1) ?? null;
  const lastId = last && last.role !== "user" ? last.id : null;
  const { markRead } = chat;
  const unread = (s?.unread ?? 0) > 0;
  useEffect(() => {
    const el = lastSeen.current;
    if (!lastId || !el || !unread) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && document.visibilityState !== "hidden")
          markRead(lastId);
      },
      { root: scroller.current, threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lastId, unread, markRead]);
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
            <li
              key={m.id}
              ref={m.id === lastId ? lastSeen : undefined}
              data-message-id={m.id}
              className={m.role === "user" ? "self-end max-w-[80%]" : "max-w-[90%]"}
            >
              {m.role === "system_note" ? (
                <p className="text-xs italic text-muted-fg">{m.contentMd}</p>
              ) : (
                <Card className={m.role === "user" ? "bg-muted p-3" : "p-3"}>
                  <span className="mb-1 block text-xs text-muted-fg">
                    {m.role === "user" ? t("chat.you") : names.author}
                  </span>
                  {m.toolCalls.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {m.toolCalls.map((tc, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: lista do histórico, imutável e sem reordenação
                        <ToolChip key={`${m.id}-${i}`} tool={tc} />
                      ))}
                    </div>
                  ) : null}
                  {m.role === "user" ? (
                    <UserContent text={m.contentMd} />
                  ) : (
                    <Markdown text={m.contentMd} />
                  )}
                  <RunLinks runIds={runsOf(m)} />
                  <PostingLinks message={m} />
                </Card>
              )}
            </li>
          ))}
          {chat.pendingUser ? (
            <li className="self-end max-w-[80%]">
              <Card className="bg-muted p-3">
                <span className="mb-1 block text-xs text-muted-fg">{t("chat.you")}</span>
                <UserContent text={chat.pendingUser} />
              </Card>
            </li>
          ) : null}
          {chat.turnActive || chat.streamed || chat.tools.length > 0 ? (
            <li className="max-w-[90%]" aria-live="polite">
              <Card className="p-3">
                <span className="mb-1 block text-xs text-muted-fg">{names.author}</span>
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
                <RunLinks runIds={liveRuns} />
              </Card>
            </li>
          ) : null}
        </ol>
      </div>
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
        <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-2">
          <span>{chat.limit === "max_turns" ? t("chat.limitTurns") : t("chat.limitBudget")}</span>
          {chat.limit === "max_turns" ? (
            <Button
              type="button"
              size="sm"
              disabled={chat.turnActive}
              onClick={() => sendText(t("chat.continueText"))}
            >
              {t("chat.continue")}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {attachError ? <Alert tone="danger">{attachError}</Alert> : null}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          aria-label={t("chat.attach")}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void attach(f);
          }}
        />
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
            {` · ${t("chat.usageCost", { cost: usd(s?.costUsdEst ?? 0) })}`}
            {typeof budget === "number"
              ? ` · ${t("chat.usageBudget", { budget: usd(budget) })}`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              aria-label={t("chat.attachPick")}
              title={t("chat.attach")}
              disabled={chat.turnActive || uploading !== null}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={14} />
              {uploading ? t("chat.attachUploading", { name: uploading }) : null}
            </Button>
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

const runsOf = (m: ChatMessage) => m.toolCalls.flatMap((tc) => (tc.runId ? [tc.runId] : []));

/**
 * Ingestão aberta no turno (2026-10-13): o link vai no corpo da mensagem do recrutador que a criou, e não fixo acima
 * do campo de mensagem (com várias ingestões não dava para saber qual era qual).
 */
function RunLinks({ runIds }: { runIds: string[] }) {
  if (runIds.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-sm">
      {runIds.map((runId) => (
        <NavLink key={runId} to={`/ingestao/${runId}`} className="underline">
          {t("chat.ingestionCreated")}
        </NavLink>
      ))}
    </div>
  );
}

/**
 * Links da mensagem (F06, F05): a conversa da análise aberta, a vaga salva, o "Criar CV para esta vaga" na mensagem que
 * gravou a análise, os documentos gerados ou alterados e o botão sugerido pelo recrutador (`ui_suggest_action`, já
 * validado pelo servidor). Vêm das tools da mensagem, não do texto do modelo (regra 7).
 */
export function PostingLinks({ message }: { message: Pick<ChatMessage, "toolCalls"> }) {
  const opened = message.toolCalls.flatMap((tc) => (tc.sessionId ? [tc.sessionId] : []));
  const postings = [
    ...new Set(message.toolCalls.flatMap((tc) => (tc.postingId ? [tc.postingId] : []))),
  ];
  const analyzed = message.toolCalls.find(
    (tc) => tc.name === "analysis_save" && tc.postingId,
  )?.postingId;
  const documents = message.toolCalls.flatMap((tc) => tc.documents ?? []);
  const actions = message.toolCalls.flatMap((tc) => (tc.action ? [tc.action] : []));
  if (
    opened.length === 0 &&
    postings.length === 0 &&
    documents.length === 0 &&
    actions.length === 0
  )
    return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      {opened.map((id) => (
        <NavLink key={id} to={`/chat/${id}`} className="underline">
          {t("chat.posting.openAnalysis")}
        </NavLink>
      ))}
      {postings.map((id) => (
        <NavLink key={id} to={`/vagas/${id}`} className="underline">
          {t("chat.posting.open")}
        </NavLink>
      ))}
      {documents.map((d) => (
        <NavLink key={d.id} to={d.url} className="underline">
          {t(d.kind === "cv" ? "chat.posting.openCv" : "chat.posting.openLetter")}
        </NavLink>
      ))}
      {analyzed && !actions.length ? (
        <NavLink
          to={`/vagas/${analyzed}?gerar=cv`}
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          {t("chat.posting.createCv")}
        </NavLink>
      ) : null}
      {actions.map((a) => (
        <NavLink key={a.url} to={a.url} className={buttonClass({ variant: "outline", size: "sm" })}>
          {a.label}
        </NavLink>
      ))}
    </div>
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
  // recrutador global (F06-8): o painel mostra o cartão do perfil em foco da conversa, ou o ativo
  const { active } = useProfiles();
  const card = useSessionCard(chat.session?.profileId ?? active?.id ?? null);
  const sources = useResearch(null);
  const tz = useTimezone();
  const used = Array.from(
    new Set([
      ...chat.history.flatMap((m) => m.toolCalls.map((tc) => tc.name)),
      ...chat.tools.map((tl) => tl.name),
    ]),
  );
  const mine = sources.filter((s) => s.sessionId === null || s.sessionId === sessionId);
  // cada ingestão da conversa tem o seu card; as anteriores ficam (finalizadas quando salvas), a mais nova em cima
  const runs = [...chat.createdRuns].reverse();
  return (
    <aside
      aria-label={t("chat.context")}
      className="hidden min-h-0 w-80 shrink-0 flex-col gap-3 overflow-y-auto lg:flex"
    >
      {/* ingestão aberta pela conversa: card próprio acima do cartão do perfil; a revisão usa a rolagem do painel */}
      {runs.length > 0 ? (
        <ul aria-label={t("chat.ingestion.list")} className="flex flex-col gap-3">
          {runs.map((runId) => (
            <li key={runId}>
              <ChatIngestionCard runId={runId} />
            </li>
          ))}
        </ul>
      ) : null}
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
              <li key={src.id} className="flex flex-col gap-1">
                <a href={src.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {src.title}
                </a>
                <span className="flex flex-wrap gap-1">
                  <Badge tone={src.trustTag === "other" ? "neutral" : "info"}>
                    {t(`chat.settings.tag.${src.trustTag}` as TKey)}
                  </Badge>
                  {src.userConfirmed ? (
                    <Badge tone="warn">{t("chat.sourceUserConfirmed")}</Badge>
                  ) : null}
                  {src.accepted === true ? (
                    <Badge tone="ok">{t("chat.sourceAccepted")}</Badge>
                  ) : src.accepted === false ? (
                    <Badge tone="neutral">{t("chat.sourceIgnored")}</Badge>
                  ) : null}
                </span>
                <span className="text-muted-fg">{src.excerpt}</span>
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
