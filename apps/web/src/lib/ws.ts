import { type WsEvent, WsEventSchema } from "@narnia-jobs/shared";

export type WsStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export interface WsClientOptions {
  url: string;
  factory?: (url: string) => SocketLike;
  backoffMs?: number[];
  maxQueue?: number;
}

/** Cliente WebSocket (F01 §2.6 `/ws`): valida eventos, reconecta com backoff e guarda eventos até haver ouvinte. */
export function createWsClient(opts: WsClientOptions) {
  const factory = opts.factory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const backoff = opts.backoffMs ?? [500, 1000, 2000, 5000, 10000];
  const maxQueue = opts.maxQueue ?? 200;
  const listeners = new Set<(e: WsEvent) => void>();
  const statusListeners = new Set<(s: WsStatus) => void>();
  const reconnectListeners = new Set<() => void>();
  let opened = false;
  const queue: WsEvent[] = [];
  let socket: SocketLike | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: WsStatus = "idle";
  let stopped = false;

  function setStatus(s: WsStatus) {
    status = s;
    for (const l of statusListeners) l(s);
  }

  function dispatch(event: WsEvent) {
    if (listeners.size === 0) {
      queue.push(event);
      if (queue.length > maxQueue) queue.shift();
      return;
    }
    for (const l of listeners) l(event);
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = backoff[Math.min(attempt, backoff.length - 1)] ?? 1000;
    attempt += 1;
    setStatus("reconnecting");
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
  }

  function open() {
    if (stopped) return;
    if (status !== "reconnecting") setStatus("connecting");
    const s = factory(opts.url);
    socket = s;
    s.onopen = () => {
      attempt = 0;
      setStatus("open");
      // reabriu depois de cair: os eventos do intervalo se perderam (o servidor não guarda), quem ouve ressincroniza
      if (opened) for (const l of reconnectListeners) l();
      opened = true;
    };
    s.onmessage = (ev) => {
      try {
        const parsed = WsEventSchema.safeParse(JSON.parse(String(ev.data)));
        if (parsed.success) dispatch(parsed.data);
      } catch {
        // payload inválido: ignorado
      }
    };
    s.onerror = () => {
      // o onclose cuida da reconexão
    };
    s.onclose = () => {
      if (socket !== s) return;
      socket = null;
      if (stopped) {
        setStatus("closed");
        return;
      }
      scheduleReconnect();
    };
  }

  return {
    connect() {
      stopped = false;
      if (!socket && !timer) open();
    },
    close() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (socket) socket.close();
      else setStatus("closed");
    },
    subscribe(listener: (e: WsEvent) => void) {
      listeners.add(listener);
      if (queue.length > 0) {
        const pending = queue.splice(0, queue.length);
        for (const e of pending) listener(e);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    onStatus(listener: (s: WsStatus) => void) {
      statusListeners.add(listener);
      listener(status);
      return () => {
        statusListeners.delete(listener);
      };
    },
    /** Avisa cada vez que a conexão reabre depois de cair (nunca na primeira conexão). */
    onReconnect(listener: () => void) {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },
    get status() {
      return status;
    },
  };
}

/**
 * Depois de uma queda do WS, recarrega as consultas: as telas que só andam por evento (o painel da ingestão no chat,
 * sem polling) ficariam paradas na última etapa recebida antes da queda (e2e F04/E2E-19 no CI, 2026-11-05).
 */
export function resyncOnReconnect(
  ws: Pick<WsClient, "onReconnect">,
  qc: { invalidateQueries: () => unknown },
): () => void {
  return ws.onReconnect(() => {
    void qc.invalidateQueries();
  });
}

export type WsClient = ReturnType<typeof createWsClient>;
