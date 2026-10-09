import {
  ExtractError,
  estimateExtraction,
  previousRunsForFile,
  type Repos,
  resolveExtractionModels,
  type SourceFileRecord,
} from "@narnia-jobs/core";
import { FileDigestPutRequestSchema, TextCreateRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import { readMeta, storeText, storeUpload, toFileResponse } from "../services/files";
import { validate } from "./validate";

function extractErrorStatus(e: ExtractError): 400 | 413 {
  return e.code === "too_large" ? 413 : 400;
}

export function filesRoutes(deps: { repos: Repos; dataDir: string }) {
  const app = new Hono();
  /** "Já lido" (F03 §2.9-5): a resposta do arquivo traz as execuções anteriores do mesmo conteúdo. */
  const withRuns = (file: SourceFileRecord, meta: ReturnType<typeof readMeta>) => ({
    ...toFileResponse(file, meta),
    previousRuns: previousRunsForFile(deps.repos, file.id),
  });

  app.post("/api/files", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File))
      return apiError(c, 400, "missing_file", "Envie o arquivo no campo `file`");
    if (file.size > 10 * 1024 * 1024)
      return apiError(c, 413, "too_large", "Arquivo acima de 10 MB");
    try {
      const stored = await storeUpload(
        deps.repos,
        deps.dataDir,
        new Uint8Array(await file.arrayBuffer()),
        file.name || null,
        "cv",
      );
      return c.json(withRuns(stored.file, stored.meta), stored.created ? 201 : 200);
    } catch (e) {
      if (e instanceof ExtractError) return apiError(c, extractErrorStatus(e), e.code, e.message);
      throw e;
    }
  });

  app.post("/api/texts", validate("json", TextCreateRequestSchema), async (c) => {
    try {
      const stored = await storeText(deps.repos, deps.dataDir, c.req.valid("json").text);
      return c.json(withRuns(stored.file, stored.meta), stored.created ? 201 : 200);
    } catch (e) {
      if (e instanceof ExtractError) return apiError(c, extractErrorStatus(e), e.code, e.message);
      throw e;
    }
  });

  app.get("/api/files/:id", (c) => {
    const file = deps.repos.sourceFiles.get(c.req.param("id"));
    if (!file) return apiError(c, 404, "not_found", "Arquivo não encontrado");
    return c.json(withRuns(file, readMeta(deps.dataDir, file)));
  });

  app.get("/api/files/:id/digest", (c) => {
    const file = deps.repos.sourceFiles.get(c.req.param("id"));
    if (!file) return apiError(c, 404, "not_found", "Arquivo não encontrado");
    return c.json({ digest: deps.repos.digests.get(file.id) });
  });

  app.put("/api/files/:id/digest", validate("json", FileDigestPutRequestSchema), (c) => {
    const file = deps.repos.sourceFiles.get(c.req.param("id"));
    if (!file) return apiError(c, 404, "not_found", "Arquivo não encontrado");
    const current = deps.repos.digests.get(file.id);
    const digest = deps.repos.digests.upsert({
      ...c.req.valid("json"),
      fileId: file.id,
      editedByUser: true,
      textPath: current?.textPath ?? null,
    });
    return c.json({ digest });
  });

  // Estimativa das chamadas ao modelo (três para PDF com tudo ligado), por modelo (F01 §2.5).
  app.get("/api/files/:id/estimate", (c) => {
    const file = deps.repos.sourceFiles.get(c.req.param("id"));
    if (!file) return apiError(c, 404, "not_found", "Arquivo não encontrado");
    const meta = readMeta(deps.dataDir, file);
    if (!meta) return apiError(c, 409, "no_meta", "Arquivo sem leitura inicial; reenvie o arquivo");
    const options = {
      ocr: c.req.query("ocr") !== "false",
      modelRead: c.req.query("modelRead") !== "false",
    };
    const est = estimateExtraction({
      textChars: meta.chars,
      ...(meta.pages ? { pdfPages: meta.pages } : {}),
      models: resolveExtractionModels(deps.repos.settings),
      options,
    });
    const calls = [
      ...(est.calls.document ? [{ name: "readDocument" as const, ...est.calls.document }] : []),
      { name: "extractFacts" as const, ...est.calls.facts },
      { name: "buildDigest" as const, ...est.calls.digest },
    ];
    return c.json({ calls, totalTokens: est.totalTokens, labels: est.labels, options });
  });

  return app;
}
