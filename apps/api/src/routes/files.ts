import {
  ExtractError,
  estimateExtraction,
  type Repos,
  resolveExtractionModels,
} from "@narnia-jobs/core";
import { TextCreateRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import { readMeta, storeText, storeUpload, toFileResponse } from "../services/files";
import { validate } from "./validate";

function extractErrorStatus(e: ExtractError): 400 | 413 {
  return e.code === "too_large" ? 413 : 400;
}

export function filesRoutes(deps: { repos: Repos; dataDir: string }) {
  const app = new Hono();

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
      return c.json(toFileResponse(stored.file, stored.meta), stored.created ? 201 : 200);
    } catch (e) {
      if (e instanceof ExtractError) return apiError(c, extractErrorStatus(e), e.code, e.message);
      throw e;
    }
  });

  app.post("/api/texts", validate("json", TextCreateRequestSchema), async (c) => {
    try {
      const stored = await storeText(deps.repos, deps.dataDir, c.req.valid("json").text);
      return c.json(toFileResponse(stored.file, stored.meta), stored.created ? 201 : 200);
    } catch (e) {
      if (e instanceof ExtractError) return apiError(c, extractErrorStatus(e), e.code, e.message);
      throw e;
    }
  });

  app.get("/api/files/:id", (c) => {
    const file = deps.repos.sourceFiles.get(c.req.param("id"));
    if (!file) return apiError(c, 404, "not_found", "Arquivo não encontrado");
    return c.json(toFileResponse(file, readMeta(deps.dataDir, file)));
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
