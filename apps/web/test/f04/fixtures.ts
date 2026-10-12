import type { ChatMessage, ChatSession } from "@narnia-jobs/shared";

const NOW = "2026-10-11T12:00:00.000Z";

export function session(id: string, partial: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    profileId: "p1",
    category: "career",
    title: `Conversa ${id}`,
    provider: "mock",
    providerSessionId: null,
    model: "sonnet",
    state: "live",
    ingestionRunId: null,
    cardHash: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsdEst: 0,
    createdAt: NOW,
    lastActivityAt: NOW,
    ...partial,
  };
}

export function message(id: string, partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    sessionId: "s1",
    turnIndex: 0,
    role: "assistant",
    contentMd: "",
    toolCalls: [],
    usage: null,
    createdAt: NOW,
    ...partial,
  };
}
