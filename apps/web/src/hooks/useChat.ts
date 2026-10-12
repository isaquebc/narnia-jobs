import type { ChatCategory, ChatMessage, ChatSession, TrustTag } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useApi, useWs } from "../app/context";

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

/**
 * Estado ao vivo de uma conversa (F04-13): os eventos `chat.*` do `/ws` da sessão aberta (os de outras sessões são
 * ignorados) montam o texto em stream, as ferramentas do turno, erro e limite; o histórico vem da API e, ao fim do
 * turno, é recarregado. A mensagem do usuário e a resposta em andamento ficam visíveis até o histórico as conter.
 */
export function useChatSession(sessionId: string) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: chatKeys.session(sessionId),
    queryFn: () => api.getChatSession(sessionId),
  });
  const messages = useQuery({
    queryKey: chatKeys.messages(sessionId),
    queryFn: () => api.listChatMessages(sessionId),
  });
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [tools, setTools] = useState<LiveTool[]>([]);
  const [turnActive, setTurnActive] = useState(false);
  const [error, setError] = useState<LiveError | null>(null);
  const [limit, setLimit] = useState<"max_turns" | "max_budget" | null>(null);
  const [lastUsage, setLastUsage] = useState<number | null>(null);
  const [createdRuns, setCreatedRuns] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [sentTurn, setSentTurn] = useState<number | null>(null);

  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "ingestion.updated") {
        if (listening) setCreatedRuns((r) => (r.includes(e.runId) ? r : [...r, e.runId]));
        return;
      }
      if (!e.type.startsWith("chat.") || !("sessionId" in e) || e.sessionId !== sessionId) return;
      switch (e.type) {
        case "chat.delta":
          setStreamed((s) => s + e.text);
          break;
        case "chat.tool":
          setTools((list) => {
            const i = list.findIndex((t) => t.name === e.name && t.phase === "start");
            const item: LiveTool = { name: e.name, phase: e.phase, durationMs: e.durationMs };
            if (e.phase !== "start" && i >= 0) return list.map((t, j) => (j === i ? item : t));
            return [...list, item];
          });
          break;
        case "chat.turn_end":
          setTurnActive(false);
          setLastUsage(e.usage.inputTokens + e.usage.outputTokens);
          void qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
          void qc.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
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
          void qc.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
          break;
      }
    });
  }, [ws, qc, sessionId, listening]);

  // o histórico recarregado já contém o turno enviado: some o que era provisório (mensagem do usuário e stream)
  const history = messages.data?.messages ?? [];
  const persistedUser =
    sentTurn !== null && history.some((m) => m.role === "user" && m.turnIndex === sentTurn);
  const persistedReply =
    sentTurn !== null &&
    !turnActive &&
    history.some((m) => m.role === "assistant" && m.turnIndex === sentTurn);

  const send = useMutation({
    mutationFn: (text: string) => api.sendChatMessage(sessionId, text),
    onMutate: (text) => {
      setPendingUser(text);
      setStreamed("");
      setTools([]);
      setError(null);
      setLimit(null);
      setTurnActive(true);
      setListening(true);
    },
    onSuccess: (r) => setSentTurn(r.turnIndex),
    onError: (e) => {
      setTurnActive(false);
      setError({ key: null, technical: e instanceof Error ? e.message : String(e) });
    },
  });
  const interrupt = useMutation({ mutationFn: () => api.interruptChat(sessionId) });
  const setModel = useMutation({
    mutationFn: (model: string) => api.patchChatSession(sessionId, { model }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat"] }),
  });
  const clearError = useCallback(() => setError(null), []);

  return {
    session: session.data?.session ?? null,
    history: history as ChatMessage[],
    pendingUser: persistedUser ? null : pendingUser,
    streamed: persistedReply ? "" : streamed,
    tools,
    turnActive,
    error,
    clearError,
    limit,
    lastUsage,
    createdRuns,
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

export function useActiveCard() {
  const api = useApi();
  return useQuery({ queryKey: ["chat", "card"], queryFn: () => api.getActiveProfileCard() });
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
