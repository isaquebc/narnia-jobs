import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Gmail falso (F14/M1, §2.0.3): responde como a API REST do Gmail e o OAuth do Google, para os testes unitários, o
 * api e o worker no mock e o e2e (estado num arquivo da pasta de dados, como o `fake-gh`). Cobre só o que o narnia usa:
 * token (código e refresh), revogação, perfil, etiquetas, busca com `after:`/`newer_than:`, mensagem (`raw`, `minimal`,
 * `full`), anexo, histórico e `batchModify`.
 */
export const FAKE_GMAIL_STATE_FILENAME = ".fake-gmail.json";

export interface FakeGmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  /** Milissegundos desde a época, como o `internalDate` do Gmail. */
  internalDate: number;
  historyId: number;
  /** E-mail no formato RFC 822 (texto). */
  raw: string;
  attachments?: Array<{ id: string; filename: string; mimeType: string; data: string }>;
}

export interface FakeGmailState {
  email: string;
  historyId: number;
  /** Histórico mais antigo ainda disponível (antes disso, `history.list` dá 404, como o Gmail depois de ~1 semana). */
  minHistoryId: number;
  labels: Array<{ id: string; name: string; type: "system" | "user" }>;
  messages: FakeGmailMessage[];
  validCode: string;
  refreshToken: string;
  accessToken: string;
  revoked: boolean;
  /** Contadores de chamadas, para os testes. */
  calls: Record<string, number>;
}

const SYSTEM_LABELS = ["INBOX", "UNREAD", "SPAM", "TRASH", "STARRED", "IMPORTANT", "SENT"];

export function fakeGmailState(over: Partial<FakeGmailState> = {}): FakeGmailState {
  return {
    email: "pessoa@example.com",
    historyId: 1000,
    minHistoryId: 1,
    labels: SYSTEM_LABELS.map((id) => ({ id, name: id, type: "system" as const })),
    messages: [],
    validCode: "code-ok",
    refreshToken: "refresh-ok",
    accessToken: "access-ok",
    revoked: false,
    calls: {},
    ...over,
  };
}

/** Acrescenta uma mensagem (avança o `historyId`, como uma chegada real). */
export function fakeGmailAdd(
  state: FakeGmailState,
  m: Omit<FakeGmailMessage, "historyId" | "threadId" | "labelIds"> &
    Partial<Pick<FakeGmailMessage, "threadId" | "labelIds">>,
): FakeGmailMessage {
  state.historyId += 1;
  const msg: FakeGmailMessage = {
    threadId: m.id,
    labelIds: ["INBOX", "UNREAD"],
    ...m,
    historyId: state.historyId,
  };
  state.messages.push(msg);
  return msg;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function headerOf(raw: string, name: string): string {
  const head = raw.split(/\r?\n\r?\n/)[0] ?? "";
  const re = new RegExp(`^${name}:\\s*(.*)$`, "im");
  return head.match(re)?.[1]?.trim() ?? "";
}

function matches(m: FakeGmailMessage, q: string, now: number): boolean {
  for (const part of q.split(/\s+/).filter(Boolean)) {
    const after = part.match(/^after:(\d+)$/);
    if (after && m.internalDate < Number(after[1]) * 1000) return false;
    const before = part.match(/^before:(\d+)$/);
    if (before && m.internalDate >= Number(before[1]) * 1000) return false;
    const newer = part.match(/^newer_than:(\d+)d$/);
    if (newer && m.internalDate < now - Number(newer[1]) * 86_400_000) return false;
    const label = part.match(/^label:(.+)$/);
    if (label && !m.labelIds.includes(label[1] as string)) return false;
    if (part === "is:unread" && !m.labelIds.includes("UNREAD")) return false;
  }
  return !m.labelIds.includes("SPAM") && !m.labelIds.includes("TRASH");
}

/** `fetch` que atende o Gmail e o OAuth a partir do estado (mutável). */
export function fakeGmailFetch(
  state: FakeGmailState,
  opts: { now?: () => number } = {},
): typeof fetch {
  const now = opts.now ?? (() => Date.now());
  const count = (k: string) => {
    state.calls[k] = (state.calls[k] ?? 0) + 1;
  };
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
      count("token");
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        if (p.get("code") !== state.validCode) return json(400, { error: "invalid_grant" });
        state.revoked = false;
        return json(200, {
          access_token: state.accessToken,
          refresh_token: state.refreshToken,
          scope: "https://www.googleapis.com/auth/gmail.modify",
          expires_in: 3599,
          token_type: "Bearer",
        });
      }
      if (p.get("grant_type") === "refresh_token") {
        if (state.revoked || p.get("refresh_token") !== state.refreshToken)
          return json(400, {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          });
        return json(200, {
          access_token: state.accessToken,
          expires_in: 3599,
          token_type: "Bearer",
        });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") {
      count("revoke");
      state.revoked = true;
      return json(200, {});
    }
    if (url.host !== "gmail.googleapis.com") return json(404, { error: "fake: host desconhecido" });
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${state.accessToken}` || state.revoked)
      return json(401, { error: { code: 401, message: "Invalid Credentials" } });
    const path = url.pathname.replace(/^\/gmail\/v1\/users\/me/, "");
    count(`${method} ${path.replace(/\/[^/]+$/, path.split("/").length > 2 ? "/:id" : "")}`);
    if (path === "/profile")
      return json(200, {
        emailAddress: state.email,
        messagesTotal: state.messages.length,
        historyId: String(state.historyId),
      });
    if (path === "/labels" && method === "GET") return json(200, { labels: state.labels });
    if (path === "/labels" && method === "POST") {
      const { name } = JSON.parse(body) as { name: string };
      if (state.labels.some((l) => l.name === name))
        return json(409, { error: { code: 409, message: "Label name exists or conflicts" } });
      const label = { id: `Label_${state.labels.length + 1}`, name, type: "user" as const };
      state.labels.push(label);
      return json(200, label);
    }
    if (path === "/messages" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const max = Number(url.searchParams.get("maxResults") ?? 100);
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const all = state.messages
        .filter((m) => matches(m, q, now()))
        .sort((a, b) => b.internalDate - a.internalDate);
      const page = all.slice(start, start + max);
      return json(200, {
        messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
        ...(start + max < all.length ? { nextPageToken: String(start + max) } : {}),
        resultSizeEstimate: all.length,
      });
    }
    if (path === "/messages/batchModify" && method === "POST") {
      const b = JSON.parse(body) as {
        ids: string[];
        addLabelIds?: string[];
        removeLabelIds?: string[];
      };
      for (const id of b.ids) {
        const m = state.messages.find((x) => x.id === id);
        if (!m) continue;
        m.labelIds = [...new Set([...m.labelIds, ...(b.addLabelIds ?? [])])].filter(
          (l) => !(b.removeLabelIds ?? []).includes(l),
        );
        state.historyId += 1;
      }
      return json(204, null);
    }
    const att = path.match(/^\/messages\/([^/]+)\/attachments\/([^/]+)$/);
    if (att) {
      const m = state.messages.find((x) => x.id === att[1]);
      const a = m?.attachments?.find((x) => x.id === att[2]);
      return a
        ? json(200, { size: a.data.length, data: b64url(a.data) })
        : json(404, { error: { code: 404 } });
    }
    const msg = path.match(/^\/messages\/([^/]+)$/);
    if (msg) {
      const m = state.messages.find((x) => x.id === msg[1]);
      if (!m)
        return json(404, { error: { code: 404, message: "Requested entity was not found." } });
      const base = {
        id: m.id,
        threadId: m.threadId,
        labelIds: m.labelIds,
        historyId: String(m.historyId),
        internalDate: String(m.internalDate),
        sizeEstimate: m.raw.length,
      };
      const format = url.searchParams.get("format") ?? "full";
      if (format === "raw") return json(200, { ...base, raw: b64url(m.raw) });
      if (format === "minimal") return json(200, base);
      const headers = [
        "From",
        "To",
        "Subject",
        "Date",
        "Reply-To",
        "Authentication-Results",
        "Message-ID",
      ]
        .map((name) => ({ name, value: headerOf(m.raw, name) }))
        .filter((h) => h.value);
      return json(200, {
        ...base,
        payload: {
          mimeType: "multipart/mixed",
          headers,
          parts: (m.attachments ?? []).map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            body: { attachmentId: a.id, size: a.data.length },
          })),
        },
      });
    }
    if (path === "/history") {
      const startId = Number(url.searchParams.get("startHistoryId") ?? 0);
      if (startId < state.minHistoryId)
        return json(404, { error: { code: 404, message: "Requested entity was not found." } });
      const added = state.messages.filter((m) => m.historyId > startId);
      return json(200, {
        historyId: String(state.historyId),
        ...(added.length
          ? {
              history: added.map((m) => ({
                id: String(m.historyId),
                messagesAdded: [
                  { message: { id: m.id, threadId: m.threadId, labelIds: m.labelIds } },
                ],
              })),
            }
          : {}),
      });
    }
    return json(404, {
      error: { code: 404, message: `fake: rota desconhecida ${method} ${path}` },
    });
  }) as typeof fetch;
}

/** Estado em arquivo (mock e e2e: api e worker veem a mesma caixa). */
export function loadFakeGmailState(file: string): FakeGmailState {
  if (!existsSync(file)) {
    const s = fakeGmailState();
    writeFileSync(file, JSON.stringify(s));
    return s;
  }
  return JSON.parse(readFileSync(file, "utf8")) as FakeGmailState;
}

/** `fetch` falso que lê e grava o estado no arquivo a cada chamada. */
export function fakeGmailFileFetch(file: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const state = loadFakeGmailState(file);
    const res = await fakeGmailFetch(state)(input, init);
    writeFileSync(file, JSON.stringify(state));
    return res;
  }) as typeof fetch;
}
