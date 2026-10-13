import {
  type ChatCategory,
  type ChatMessage,
  type ChatSession,
  friendlyError,
  type TrustTag,
} from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi, useWs } from "../app/context";
import { sessionLimitOf } from "../features/chat/SessionLimitDialog";
import { ApiError } from "../lib/api";
import { useProfileCard } from "./useProfileCard";

export const chatKeys = {
  sessions: (profileId: string | null) => ["chat", "sessions", profileId] as const,
  session: (id: string) => ["chat", "session", id] as const,
  messages: (id: string) => ["chat", "messages", id] as const,
  research: (profileId: string | null) => ["chat", "research", profileId] as const,
  settings: ["chat", "settings"] as const,
  domains: ["chat", "domains"] as const,
};

/** Conversas do perfil (F04 §4): lista, criar (409 `session_limit` sobe para a UI perguntar), renomear, arquivar. */
export function useChatSessions(profileId: string | null) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: chatKeys.sessions(profileId),
    queryFn: () => api.listChatSessions(profileId),
    enabled: profileId !== null,
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "chat.session_updated" || e.type === "profile.switched")
        void qc.invalidateQueries({ queryKey: ["chat", "sessions"] });
    });
  }, [ws, qc]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["chat"] });
  const create = useMutation({
    mutationFn: (req: { category?: ChatCategory; model?: string; title?: string }) =>
      api.createChatSession({ ...(profileId ? { profileId } : {}), ...req }),
    onSuccess: refresh,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; title?: string; model?: string; archived?: boolean }) => {
      const { id, ...rest } = v;
      return api.patchChatSession(id, rest);
    },
    onSuccess: refresh,
  });
  const hibernate = useMutation({
    mutationFn: (id: string) => api.hibernateChat(id),
    onSuccess: refresh,
  });
  return { ...query, sessions: query.data?.sessions ?? [], create, patch, hibernate };
}

export interface LiveTool {
  name: string;
  phase: "start" | "end" | "error";
  durationMs?: number | undefined;
}
export interface LiveError {
  key: string | null;
  technical: string;
}

/** Página do histórico (a rota aceita até 200; 50 cobre ~25 turnos). */
export const HISTORY_PAGE = 50;

/** Erro de uma rota em linguagem simples: o mapa do `shared` classifica pelo código e pelo texto (auditoria D). */
export function liveErrorOf(e: unknown): LiveError {
  const code = e instanceof ApiError ? e.code : null;
  const message = e instanceof Error ? e.message : String(e);
  return { key: friendlyError({ code, message }).key, technical: message };
}

/**
 * Estado ao vivo de uma conversa (F04-13): os eventos `chat.*` do `/ws` da sessão aberta (os de outras sessões são
 * ignorados) montam o texto em stream, as ferramentas do turno, erro e limite; o histórico vem da API e, ao fim do
 * turno, é recarregado e só então o que era provisório (mensagem do usuário, stream) some, sem duplicar.
 *
 * Auditoria D: o "pensando" também vem da sessão (`busy`, para recarregar a página no meio de um turno) e acaba com
 * a sessão saindo de "ativa"; o link da ingestão vem só das tools de ingestão desta conversa
 * (`chat.ingestion_created` ao vivo, `runId` da tool call no histórico); "Carregar anteriores" pagina com `before` e,
 * a partir daí, a página recente vem por `since` (da âncora em diante), para mensagens novas não abrirem buraco.
 */
export function useChatSession(sessionId: string) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: chatKeys.session(sessionId),
    queryFn: () => api.getChatSession(sessionId),
  });
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [moreOlder, setMoreOlder] = useState(true);
  const messages = useQuery({
    queryKey: [...chatKeys.messages(sessionId), anchor] as const,
    queryFn: () =>
      api.listChatMessages(
        sessionId,
        anchor ? { since: anchor, limit: 200 } : { limit: HISTORY_PAGE },
      ),
    placeholderData: (prev) => prev,
  });
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [tools, setTools] = useState<LiveTool[]>([]);
  const [turnActive, setTurnActive] = useState(false);
  const [error, setError] = useState<LiveError | null>(null);
  const [limit, setLimit] = useState<"max_turns" | "max_budget" | null>(null);
  const [lastUsage, setLastUsage] = useState<number | null>(null);
  const [liveRuns, setLiveRuns] = useState<string[]>([]);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const sentAt = useRef(0);
  const sentOkAt = useRef(0);
  const sending = useRef(false);

  // recarregou a página no meio de um turno: a sessão diz que está ocupada (bloco B). O turno acabou sem aviso (api
  // reiniciou, evento perdido na reconexão): a sessão relida depois do envio diz que não está mais, e o "pensando" sai
  const busy = session.data?.session.busy;
  const fetchedAt = session.dataUpdatedAt;
  useEffect(() => {
    if (busy === undefined) return;
    if (busy && fetchedAt >= sentAt.current) setTurnActive(true);
    if (!busy && !sending.current && fetchedAt > sentOkAt.current) setTurnActive(false);
  }, [busy, fetchedAt]);

  useEffect(() => {
    ws.connect();
    const settle = () =>
      void qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) }).then(() => {
        setStreamed("");
        setTools([]);
        setPendingUser(null);
      });
    return ws.subscribe((e) => {
      if (!e.type.startsWith("chat.") || !("sessionId" in e) || e.sessionId !== sessionId) return;
      switch (e.type) {
        case "chat.delta":
          setTurnActive(true);
          setStreamed((s) => s + e.text);
          break;
        case "chat.tool":
          setTurnActive(true);
          setTools((list) => {
            const i = list.findIndex((t) => t.name === e.name && t.phase === "start");
            const item: LiveTool = { name: e.name, phase: e.phase, durationMs: e.durationMs };
            if (e.phase !== "start" && i >= 0) return list.map((t, j) => (j === i ? item : t));
            return [...list, item];
          });
          break;
        case "chat.ingestion_created":
          setLiveRuns((r) => (r.includes(e.runId) ? r : [...r, e.runId]));
          break;
        case "chat.turn_end":
          setTurnActive(false);
          setLastUsage(e.usage.inputTokens + e.usage.outputTokens);
          void qc.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
          // fontes e perfil podem ter mudado no turno (research_save/research_apply, auditoria E1)
          void qc.invalidateQueries({ queryKey: ["chat", "research"] });
          // o histórico recarregado já tem o turno (inclusive a parcial de um turno interrompido): some o provisório
          settle();
          break;
        case "chat.error":
          setTurnActive(false);
          setError({ key: e.errorKey ?? null, technical: e.error });
          break;
        case "chat.limit":
          setTurnActive(false);
          setLimit(e.reason);
          break;
        case "chat.session_updated":
          // hibernada, arquivada ou com erro no meio de um turno: o "pensando" acaba (auditoria D)
          if (e.state !== "live") setTurnActive(false);
          void qc.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
          // nota do sistema gravada sem turno (ex.: ingestão pronta com o teto de custo atingido)
          void qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
          break;
      }
    });
  }, [ws, qc, sessionId]);

  const latest = messages.data?.messages ?? [];
  const latestIds = new Set(latest.map((m) => m.id));
  const history = [...older.filter((m) => !latestIds.has(m.id)), ...latest];
  const hasOlder = anchor === null ? latest.length >= HISTORY_PAGE : moreOlder;
  const loadOlder = useMutation({
    mutationFn: () => {
      const first = history[0];
      if (!first) return Promise.resolve({ messages: [] as ChatMessage[] });
      return api.listChatMessages(sessionId, { before: first.id, limit: HISTORY_PAGE });
    },
    onSuccess: (r) => {
      const first = history[0];
      if (anchor === null && first) setAnchor(latest[0]?.id ?? first.id);
      setOlder((cur) => [...r.messages, ...cur]);
      setMoreOlder(r.messages.length >= HISTORY_PAGE);
    },
  });

  const runIds = Array.from(
    new Set([
      ...history.flatMap((m) => m.toolCalls.flatMap((tc) => (tc.runId ? [tc.runId] : []))),
      ...liveRuns,
    ]),
  );

  const send = useMutation({
    mutationFn: (text: string) => api.sendChatMessage(sessionId, text),
    onMutate: (text) => {
      sentAt.current = Date.now();
      sending.current = true;
      setPendingUser(text);
      setStreamed("");
      setTools([]);
      setError(null);
      setLimit(null);
      setTurnActive(true);
    },
    onSuccess: (r) => {
      sentOkAt.current = Date.now();
      setSentTurn(r.turnIndex);
    },
    onSettled: () => {
      sending.current = false;
    },
    onError: (e) => {
      // a mensagem não foi: some a bolha provisória (quem chamou devolve o texto ao campo)
      setTurnActive(false);
      setPendingUser(null);
      if (!sessionLimitOf(e)) setError(liveErrorOf(e));
    },
  });
  const interrupt = useMutation({ mutationFn: () => api.interruptChat(sessionId) });
  const setModel = useMutation({
    mutationFn: (model: string) => api.patchChatSession(sessionId, { model }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat"] }),
  });
  const clearError = useCallback(() => setError(null), []);

  // a mensagem do usuário já está no histórico: não mostra a bolha provisória duas vezes
  const persistedUser =
    sentTurn !== null && history.some((m) => m.role === "user" && m.turnIndex === sentTurn);

  return {
    session: session.data?.session ?? null,
    history: history as ChatMessage[],
    pendingUser: persistedUser ? null : pendingUser,
    streamed,
    tools,
    turnActive,
    error,
    clearError,
    limit,
    lastUsage,
    createdRuns: runIds,
    hasOlder,
    loadOlder,
    send,
    interrupt,
    setModel,
    isLoading: session.isLoading || messages.isLoading,
  };
}

export function useResearch(profileId: string | null) {
  const api = useApi();
  const q = useQuery({
    queryKey: chatKeys.research(profileId),
    queryFn: () => api.listResearch(profileId),
  });
  return q.data?.sources ?? [];
}

/**
 * Cartão para o painel "Contexto": a rota do cartão da F02 (só o cartão). A rota `persona-card` é do hook do terminal
 * e traz o prompt inteiro (persona e regras), que não deve aparecer na tela (regressão do e2e F04/E2E-05). É o perfil
 * da conversa, não o ativo: o usuário pode ter trocado de perfil em outra tela (auditoria A).
 */
export function useSessionCard(profileId: string | null | undefined) {
  return useProfileCard(profileId ?? undefined);
}

export function useChatSettings() {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: chatKeys.settings, queryFn: () => api.getChatSettings() });
  const save = useMutation({
    mutationFn: (p: Parameters<typeof api.putChatSettings>[0]) => api.putChatSettings(p),
    onSuccess: (r) => qc.setQueryData(chatKeys.settings, r),
  });
  return { ...query, settings: query.data?.settings ?? null, save };
}

export function useTrustedDomains() {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: chatKeys.domains, queryFn: () => api.listTrustedDomains() });
  const refresh = () => qc.invalidateQueries({ queryKey: chatKeys.domains });
  const add = useMutation({
    mutationFn: (d: { pattern: string; trustTag: TrustTag }) => api.addTrustedDomain(d),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.patchTrustedDomain(v.id, v.enabled),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTrustedDomain(id),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: () => api.restoreTrustedDomains(),
    onSuccess: refresh,
  });
  return { ...query, domains: query.data?.domains ?? [], add, toggle, remove, restore };
}

export type { ChatSession };
