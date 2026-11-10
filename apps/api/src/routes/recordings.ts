import {
  appendRecordingChunk,
  createRecording,
  RecordingError,
  type RecordingErrorCode,
  type Repos,
  recordingLimits,
  recordingVideoPath,
  removeRecording,
  removeRecordingVideo,
} from "@narnia-jobs/core";
import {
  RECORDING_CHUNK_BYTES,
  RecordingCreateSchema,
  RecordingLimitsSchema,
} from "@narnia-jobs/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError } from "../errors";
import { serveFile } from "../serve-file";
import { validate } from "./validate";

/**
 * F13 · entrevista gravada, envio e reprodução (plans/plan-v0/tasks/F13 §6.1.1, R5 e R6). O navegador cria a entrevista
 * com nome e tamanho, manda partes de até 8 MB (`PUT …/video?offset=N`, corpo cru) e, se a aba fechar ou a rede cair,
 * pergunta quantos bytes já chegaram (`GET …`) e continua dali. O vídeo pronto é servido com `Range`.
 */
const STATUS: Record<RecordingErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  invalid: 400,
  unsupported_type: 415,
  too_large: 413,
  insufficient_storage: 507,
  offset_mismatch: 409,
  not_uploading: 409,
};

export function recordingsRoutes(deps: { repos: Repos; dataDir: string }) {
  const { repos, dataDir } = deps;
  const app = new Hono();
  const fail = (c: Context, e: unknown) => {
    if (e instanceof RecordingError)
      return apiError(c, STATUS[e.code], e.code, e.message, e.details);
    throw e;
  };
  const notFound = (c: Context) => apiError(c, 404, "not_found", "Entrevista não encontrada.");

  // limites do envio (F13-11), em Configurações › Análise de vídeo
  app.get("/api/settings/recordings", (c) => c.json(recordingLimits(repos)));
  app.put("/api/settings/recordings", validate("json", RecordingLimitsSchema), (c) => {
    repos.settings.set("recordings.limits", c.req.valid("json"));
    return c.json(recordingLimits(repos));
  });

  app.post("/api/recordings", validate("json", RecordingCreateSchema), (c) => {
    try {
      return c.json(createRecording(repos, dataDir, c.req.valid("json")), 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/recordings", (c) => {
    const appId = c.req.query("jobApplicationId");
    const profileId = c.req.query("profileId");
    if (!appId && !profileId)
      return apiError(c, 400, "invalid", "Informe jobApplicationId ou profileId.");
    const recordings = appId
      ? repos.recordings.listByApplication(appId)
      : repos.recordings.listByProfile(profileId as string);
    return c.json({ recordings });
  });

  app.get("/api/recordings/:id", (c) => {
    const rec = repos.recordings.get(c.req.param("id"));
    return rec ? c.json(rec) : notFound(c);
  });

  app.put("/api/recordings/:id/video", async (c) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > RECORDING_CHUNK_BYTES)
      return apiError(c, 413, "too_large", "Parte maior que 8 MB.");
    const offset = Number(c.req.query("offset"));
    if (!Number.isInteger(offset) || offset < 0)
      return apiError(c, 400, "invalid", "offset inválido.");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > RECORDING_CHUNK_BYTES)
      return apiError(c, 413, "too_large", "Parte maior que 8 MB.");
    try {
      return c.json(appendRecordingChunk(repos, dataDir, c.req.param("id"), offset, bytes));
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/recordings/:id/video", (c) => {
    const rec = repos.recordings.get(c.req.param("id"));
    const path = rec ? recordingVideoPath(dataDir, rec) : null;
    if (!rec || !path) return apiError(c, 404, "not_found", "Vídeo indisponível.");
    return serveFile(c, path, {
      "content-type": /^video\/[\w.+-]+$/.test(rec.mime) ? rec.mime : "application/octet-stream",
      "content-disposition": "inline",
      "cache-control": "private, no-store",
    });
  });

  app.delete("/api/recordings/:id/video", (c) => {
    try {
      return c.json(removeRecordingVideo(repos, dataDir, c.req.param("id")));
    } catch (e) {
      return fail(c, e);
    }
  });

  app.delete("/api/recordings/:id", (c) => {
    try {
      removeRecording(repos, dataDir, c.req.param("id"));
      return c.body(null, 204);
    } catch (e) {
      return fail(c, e);
    }
  });
  return app;
}
