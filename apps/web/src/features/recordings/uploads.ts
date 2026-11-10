import type { Recording } from "@narnia-jobs/shared";
import { useSyncExternalStore } from "react";
import { type ChunkApi, uploadRecording } from "./upload";

/**
 * Envios em andamento nesta aba (F13/M1.5). Ficam fora dos componentes para que trocar de página no app não interrompa
 * um vídeo de alguns GB; fechar a aba interrompe, e o envio continua depois escolhendo o mesmo arquivo. Enquanto há
 * envio, o navegador pergunta antes de fechar a aba.
 */
export interface UploadState {
  recordingId: string;
  fileName: string;
  received: number;
  size: number;
  error: string | null;
  done: boolean;
}

type Entry = UploadState & { ctl: AbortController };
let entries = new Map<string, Entry>();
let snapshot: UploadState[] = [];
const listeners = new Set<() => void>();

const active = () => [...entries.values()].some((e) => !e.done && !e.error);
const onBeforeUnload = (ev: BeforeUnloadEvent) => {
  if (!active()) return;
  ev.preventDefault();
  ev.returnValue = "";
};

function emit() {
  snapshot = [...entries.values()].map(({ ctl: _ctl, ...s }) => s);
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (active()) window.addEventListener("beforeunload", onBeforeUnload);
  }
  for (const l of listeners) l();
}

function patch(id: string, p: Partial<UploadState>) {
  const e = entries.get(id);
  if (!e) return;
  entries.set(id, { ...e, ...p });
  emit();
}

/** Começa (ou retoma) o envio; `onSettled` roda no fim, com sucesso ou erro (para reler a lista). */
export function startUpload(
  api: ChunkApi,
  rec: Recording,
  file: File,
  onSettled: (r: Recording | null) => void,
): void {
  if (entries.get(rec.id) && !entries.get(rec.id)?.error && !entries.get(rec.id)?.done) return;
  const ctl = new AbortController();
  entries.set(rec.id, {
    recordingId: rec.id,
    fileName: rec.fileName,
    received: rec.received,
    size: rec.size,
    error: null,
    done: false,
    ctl,
  });
  emit();
  uploadRecording(api, rec, file, {
    signal: ctl.signal,
    onProgress: (received) => patch(rec.id, { received }),
  }).then(
    (r) => {
      patch(rec.id, { received: r.received, done: true });
      onSettled(r);
    },
    (e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") {
        entries.delete(rec.id);
        emit();
      } else patch(rec.id, { error: e instanceof Error ? e.message : String(e) });
      onSettled(null);
    },
  );
}

export function cancelUpload(id: string): void {
  entries.get(id)?.ctl.abort();
}

/** Esquece o estado de um envio (erro já mostrado ou entrevista apagada). */
export function clearUpload(id: string): void {
  if (entries.delete(id)) emit();
}

/** Só para testes. */
export function resetUploads(): void {
  for (const e of entries.values()) e.ctl.abort();
  entries = new Map();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useUploads(): UploadState[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
