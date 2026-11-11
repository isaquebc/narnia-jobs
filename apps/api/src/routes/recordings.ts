import {
  appendRecordingChunk,
  correctTurnPerson,
  createRecording,
  type MediaClient,
  patchRecordingPerson,
  RECORDING_TASKS,
  RecordingError,
  type RecordingErrorCode,
  type Repos,
  recordingAnalysis,
  recordingFramePath,
  recordingLimits,
  recordingVideoPath,
  removeRecording,
  removeRecordingVideo,
} from "@narnia-jobs/core";
import {
  RECORDING_CHUNK_BYTES,
  type Recording,
  RecordingCreateSchema,
  RecordingLimitsSchema,
  RecordingPersonPatchSchema,
  RecordingTurnPatchSchema,
} from "@narnia-jobs/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { serveFile } from "../serve-file";
import { validate } from "./validate";

/**
 * F13 · entrevista gravada, envio e reprodução (plans/plan-v0/tasks/done/F13 §6.1.1, R5 e R6). O navegador cria a entrevista
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

export function recordingsRoutes(deps: {
  repos: Repos;
  dataDir: string;
  queue: QueueAdapter;
  bus: EventBus;
  media: MediaClient;
}) {
  const { repos, dataDir } = deps;
  const announce = (r: Recording) => {
    deps.bus.emit({
      type: "recording.updated",
      recordingId: r.id,
      state: r.state,
      step: r.step,
      progress: r.progress,
    });
    return r;
  };
  /** F13/M4: análise na fila `media` (uma por vez); o worker pede as etapas ao serviço. */
  const enqueueAnalysis = async (rec: Recording) => {
    await deps.queue.enqueueTask({
      queue: "media",
      type: RECORDING_TASKS.analyze,
      key: `${rec.id}-${Date.now()}`,
      payload: { recordingId: rec.id },
      profileId: rec.profileId,
    });
    return announce(
      repos.recordings.update(rec.id, { state: "analyzing", step: null, progress: 0, error: null }),
    );
  };
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
    let rec: Recording;
    try {
      rec = appendRecordingChunk(repos, dataDir, c.req.param("id"), offset, bytes);
    } catch (e) {
      return fail(c, e);
    }
    // última parte: com o media no ar, a análise começa sozinha; desligado, fica `uploaded` até ligar
    if (rec.state === "uploaded" && (await deps.media.status()).state !== "off")
      rec = await enqueueAnalysis(rec);
    return c.json(rec);
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

  app.post("/api/recordings/:id/analyze", async (c) => {
    const rec = repos.recordings.get(c.req.param("id"));
    if (!rec) return notFound(c);
    if (rec.state === "uploading" || rec.state === "analyzing")
      return apiError(c, 409, "not_ready", "A entrevista ainda está sendo enviada ou analisada.");
    if (!recordingVideoPath(dataDir, rec))
      return apiError(c, 409, "no_video", "O vídeo foi apagado: não dá para analisar de novo.");
    const status = await deps.media.status();
    if (status.state === "off")
      return apiError(
        c,
        409,
        "media_off",
        `A análise de vídeo está desligada. Ligue com ${status.enableCommand} no computador do narnia.`,
      );
    return c.json(await enqueueAnalysis(rec), 202);
  });

  app.get("/api/recordings/:id/analysis", (c) => {
    try {
      return c.json(recordingAnalysis(repos, c.req.param("id")));
    } catch (e) {
      return fail(c, e);
    }
  });

  app.patch(
    "/api/recordings/:id/persons/:personId",
    validate("json", RecordingPersonPatchSchema),
    (c) => {
      try {
        return c.json(
          patchRecordingPerson(
            repos,
            c.req.param("id"),
            c.req.param("personId"),
            c.req.valid("json"),
          ),
        );
      } catch (e) {
        return fail(c, e);
      }
    },
  );

  app.patch(
    "/api/recordings/:id/turns/:turnId",
    validate("json", RecordingTurnPatchSchema),
    (c) => {
      try {
        return c.json(
          correctTurnPerson(
            repos,
            c.req.param("id"),
            c.req.param("turnId"),
            c.req.valid("json").personId,
          ),
        );
      } catch (e) {
        return fail(c, e);
      }
    },
  );

  app.get("/api/recordings/:id/frames/:file", (c) => {
    const path = recordingFramePath(dataDir, c.req.param("id"), c.req.param("file"));
    if (!path) return apiError(c, 404, "not_found", "Quadro não encontrado.");
    return serveFile(c, path, {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=3600",
    });
  });

  /** Refazer o relatório (depois de corrigir pessoas ou turnos): só a cadeia do recrutador, sem o media. */
  app.post("/api/recordings/:id/report", async (c) => {
    const rec = repos.recordings.get(c.req.param("id"));
    if (!rec) return notFound(c);
    if (!rec.analyzedAt)
      return apiError(c, 409, "not_ready", "A análise do vídeo ainda não terminou.");
    if (rec.state === "analyzing")
      return apiError(c, 409, "not_ready", "A análise está em andamento.");
    await deps.queue.enqueueTask({
      queue: "extract",
      type: RECORDING_TASKS.report,
      key: `${rec.id}-${Date.now()}`,
      payload: { recordingId: rec.id },
      profileId: rec.profileId,
    });
    return c.json(
      announce(
        repos.recordings.update(rec.id, {
          state: "analyzing",
          step: "report",
          progress: 94,
          error: null,
        }),
      ),
      202,
    );
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
