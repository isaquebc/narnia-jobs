import { RECORDING_CHUNK_BYTES, type Recording } from "@narnia-jobs/shared";
import { ApiError } from "../../lib/api";

/**
 * F13/M1.5 · envio do vídeo em partes (plans/plan-v0/tasks/done/F13 §6.1.1, R5). Começa de onde o servidor parou
 * (`rec.received`), manda uma parte por vez e segue o `received` que o servidor devolve no `offset_mismatch` (resposta
 * perdida ou outra aba). Queda de rede ou erro passageiro do servidor: espera e tenta de novo, até `retries` vezes
 * seguidas. Erro definitivo (tamanho, entrevista apagada…) para o envio com a mensagem do servidor.
 */
export interface ChunkApi {
  putRecordingChunk(id: string, offset: number, chunk: Blob): Promise<Recording>;
}

export interface UploadOptions {
  chunkBytes?: number;
  retries?: number;
  signal?: AbortSignal;
  /** Bytes que já chegaram, depois de cada parte aceita. */
  onProgress?: (received: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

export class UploadError extends Error {
  override readonly name = "UploadError";
  constructor(
    readonly code: "different_file",
    message: string,
  ) {
    super(message);
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const abortError = () => new DOMException("Envio cancelado.", "AbortError");
/** Vale tentar de novo: rede caiu ou o servidor falhou de passagem (507, sem disco, não passa sozinho). */
const transient = (e: unknown) =>
  e instanceof ApiError && (e.status === 0 || (e.status >= 500 && e.status !== 507));

export async function uploadRecording(
  api: ChunkApi,
  rec: Recording,
  file: File,
  opts: UploadOptions = {},
): Promise<Recording> {
  const chunk = opts.chunkBytes ?? RECORDING_CHUNK_BYTES;
  const retries = opts.retries ?? 6;
  const sleep = opts.sleep ?? wait;
  if (file.size !== rec.size)
    throw new UploadError(
      "different_file",
      "Esse não é o mesmo arquivo que começou a ser enviado (o tamanho é diferente).",
    );
  let current = rec;
  let offset = rec.received;
  let failures = 0;
  while (offset < file.size) {
    if (opts.signal?.aborted) throw abortError();
    try {
      current = await api.putRecordingChunk(rec.id, offset, file.slice(offset, offset + chunk));
      offset = current.received;
      failures = 0;
      opts.onProgress?.(offset);
    } catch (e) {
      if (e instanceof ApiError && e.code === "offset_mismatch") {
        const received = (e.details as { received?: unknown } | undefined)?.received;
        if (typeof received !== "number") throw e;
        offset = received;
        continue;
      }
      if (transient(e) && failures < retries) {
        failures += 1;
        await sleep(Math.min(30_000, 1000 * 2 ** (failures - 1)));
        continue;
      }
      throw e;
    }
  }
  return current;
}
