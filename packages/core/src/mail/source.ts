/**
 * Fonte de e-mails (F14-4, §2.0.3): a interface que a sincronização usa, com a implementação pela API REST do Gmail.
 * Os testes e o mock usam a mesma classe com o `fetch` do Gmail falso (`testing/fake-gmail.ts`).
 */
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface MailMessageRaw {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: number;
  historyId: string;
  raw: Buffer;
}

export interface MailSource {
  profile(): Promise<{ email: string; historyId: string; messagesTotal: number }>;
  /** Garante as etiquetas pelo nome (cria as que faltam) e devolve nome → id. */
  ensureLabels(names: string[]): Promise<Record<string, string>>;
  listMessageIds(q: string, max: number): Promise<string[]>;
  getRaw(id: string): Promise<MailMessageRaw>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  /** Mensagens novas desde o `historyId`; `expired` quando o Gmail já não guarda esse histórico (≈ 1 semana). */
  history(
    startHistoryId: string,
  ): Promise<{ historyId: string; messageIds: string[] } | { expired: true }>;
  modify(ids: string[], change: { add?: string[]; remove?: string[] }): Promise<void>;
}

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

export class GmailRestSource implements MailSource {
  constructor(
    private readonly o: {
      fetch: typeof fetch;
      accessToken: () => Promise<string>;
      baseUrl?: string;
    },
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.o.accessToken();
    const r = await this.o.fetch(`${this.o.baseUrl ?? GMAIL_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (r.status === 204) return null as T;
    const body = (await r.json().catch(() => null)) as T & { error?: { message?: string } };
    if (!r.ok)
      throw new GmailApiError(
        r.status,
        `Gmail ${init.method ?? "GET"} ${path.split("?")[0]}: ${r.status} ${body?.error?.message ?? ""}`.trim(),
      );
    return body;
  }

  async profile() {
    const p = await this.call<{ emailAddress: string; historyId: string; messagesTotal: number }>(
      "/profile",
    );
    return {
      email: p.emailAddress,
      historyId: String(p.historyId),
      messagesTotal: Number(p.messagesTotal),
    };
  }

  async ensureLabels(names: string[]) {
    const { labels } = await this.call<{ labels: Array<{ id: string; name: string }> }>("/labels");
    const out: Record<string, string> = {};
    for (const name of names) {
      const found = labels.find((l) => l.name === name);
      if (found) {
        out[name] = found.id;
        continue;
      }
      const created = await this.call<{ id: string }>("/labels", {
        method: "POST",
        body: JSON.stringify({
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        }),
      });
      out[name] = created.id;
    }
    return out;
  }

  async listMessageIds(q: string, max: number) {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({ q, maxResults: String(Math.min(500, max)) });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await this.call<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
        `/messages?${p}`,
      );
      ids.push(...(r.messages ?? []).map((m) => m.id));
      pageToken = r.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  async getRaw(id: string) {
    const m = await this.call<{
      id: string;
      threadId: string;
      labelIds?: string[];
      internalDate: string;
      historyId: string;
      raw: string;
    }>(`/messages/${encodeURIComponent(id)}?format=raw`);
    return {
      id: m.id,
      threadId: m.threadId,
      labelIds: m.labelIds ?? [],
      internalDate: Number(m.internalDate),
      historyId: String(m.historyId),
      raw: Buffer.from(m.raw, "base64url"),
    };
  }

  async getAttachment(messageId: string, attachmentId: string) {
    const a = await this.call<{ data: string }>(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return Buffer.from(a.data, "base64url");
  }

  async history(startHistoryId: string) {
    const ids: string[] = [];
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    try {
      do {
        const p = new URLSearchParams({
          startHistoryId,
          historyTypes: "messageAdded",
          maxResults: "500",
        });
        if (pageToken) p.set("pageToken", pageToken);
        const r = await this.call<{
          historyId: string;
          nextPageToken?: string;
          history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
        }>(`/history?${p}`);
        for (const h of r.history ?? [])
          for (const a of h.messagesAdded ?? []) ids.push(a.message.id);
        historyId = String(r.historyId);
        pageToken = r.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (e instanceof GmailApiError && e.status === 404) return { expired: true as const };
      throw e;
    }
    return { historyId, messageIds: [...new Set(ids)] };
  }

  async modify(ids: string[], change: { add?: string[]; remove?: string[] }) {
    for (let i = 0; i < ids.length; i += 1000)
      await this.call("/messages/batchModify", {
        method: "POST",
        body: JSON.stringify({
          ids: ids.slice(i, i + 1000),
          ...(change.add?.length ? { addLabelIds: change.add } : {}),
          ...(change.remove?.length ? { removeLabelIds: change.remove } : {}),
        }),
      });
  }
}
