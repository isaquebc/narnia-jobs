import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_TEMPLATES,
  changeDocumentLayout,
  DocumentEditError,
  type DocumentRecord,
  DocumentRequestError,
  type DocumentView,
  documentDiff,
  documentView,
  editDocument,
  type Repos,
  type RequestDocumentInput,
  requestDocument,
} from "@narnia-jobs/core";
import {
  type CoverLetterContent,
  CoverLetterDraftSchema,
  CoverLetterFormatSchema,
  type CvContent,
  CvDraftSchema,
  DocumentKindSchema,
  IdSchema,
  PaperSchema,
} from "@narnia-jobs/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { validate } from "./validate";

/**
 * CV e carta (F05 §2.10): gerar (o mesmo caminho do recrutador), "Atualizar", listar por perfil ou vaga, ver o
 * documento com as versões e a validade, baixar o PDF, ver as páginas em PNG e o texto da carta, apagar. Os arquivos
 * ficam em `<dados>/documents/<id>/v<n>/` e o navegador baixa pelo cookie da sessão (mesma origem).
 */
const GenerateSchema = z.object({
  kind: DocumentKindSchema,
  profileId: IdSchema,
  postingId: IdSchema.nullable().optional(),
  instructions: z.string().max(2000).nullable().optional(),
  acceptLanguage: z.boolean().optional(),
  templateId: z.string().min(1).max(64).optional(),
  format: CoverLetterFormatSchema.optional(),
  /** CV da vaga com a carta junto (F05-21). */
  withCoverLetter: z.boolean().optional(),
});
const EditSchema = z.object({
  baseVersion: z.number().int().min(1),
  cv: CvDraftSchema.optional(),
  letter: CoverLetterDraftSchema.optional(),
});
const LayoutSchema = z
  .object({
    templateId: z.string().min(1).max(64).optional(),
    paper: PaperSchema.optional(),
    format: CoverLetterFormatSchema.optional(),
  })
  .refine((v) => v.templateId || v.paper || v.format, "Informe o modelo, o papel ou o formato.");

const EDIT_STATUS: Record<DocumentEditError["code"], ContentfulStatusCode> = {
  document_not_found: 404,
  template_not_found: 404,
  conflict: 409,
  busy: 409,
  missing_content: 400,
};
function editErrorResponse(c: Context, e: unknown) {
  if (e instanceof DocumentEditError) return apiError(c, EDIT_STATUS[e.code], e.code, e.message);
  throw e;
}

const RegenerateSchema = z.object({
  instructions: z.string().max(2000).nullable().optional(),
  acceptLanguage: z.boolean().optional(),
});

const REQUEST_STATUS: Record<DocumentRequestError["code"], ContentfulStatusCode> = {
  profile_not_found: 404,
  posting_not_found: 404,
  document_not_found: 404,
  posting_required: 400,
  language_not_covered: 409,
};

function requestErrorResponse(c: Context, e: unknown) {
  if (e instanceof DocumentRequestError)
    return apiError(
      c,
      REQUEST_STATUS[e.code],
      e.code,
      e.message,
      e.language ? { language: e.language } : undefined,
    );
  throw e;
}

/** Nome do arquivo para baixar: "CV - Ana Souza - Initech.pdf". */
function downloadName(repos: Repos, view: DocumentView): string {
  const user = repos.users.get();
  const posting = view.document.postingId ? repos.postings.get(view.document.postingId) : null;
  const what =
    view.document.kind === "cv"
      ? "CV"
      : view.document.locale === "en-US"
        ? "Cover letter"
        : "Carta";
  const target = posting ? (posting.client ?? posting.company) : null;
  return `${[what, user?.fullName ?? user?.displayName, target].filter(Boolean).join(" - ")}.pdf`.replace(
    /[\\/:*?"<>|]/g,
    "",
  );
}

export function documentsRoutes(deps: {
  repos: Repos;
  queue: QueueAdapter;
  dataDir: string;
  bus?: EventBus;
}) {
  const app = new Hono();
  const { repos } = deps;
  const enqueue = (req: Parameters<QueueAdapter["enqueueTask"]>[0]) => deps.queue.enqueueTask(req);
  const announce = (v: DocumentView) =>
    deps.bus?.emit({
      type: "document.updated",
      documentId: v.document.id,
      profileId: v.document.profileId,
      postingId: v.document.postingId,
      status: v.current?.status ?? "queued",
    });
  const notFound = (c: Context) =>
    apiError(c, 404, "document_not_found", "Documento não encontrado");
  const versionOf = (c: Context) => {
    const doc = repos.documents.get(c.req.param("id") ?? "");
    const n = Number(c.req.param("n"));
    const version = doc && Number.isInteger(n) ? repos.documents.getVersion(doc.id, n) : null;
    return doc && version ? { doc, version } : null;
  };

  app.get("/api/documents", (c) => {
    const profileId = c.req.query("profileId");
    const postingId = c.req.query("postingId");
    const kind = DocumentKindSchema.safeParse(c.req.query("kind"));
    const docs = repos.documents.list({
      ...(profileId ? { profileId } : {}),
      ...(postingId ? { postingId } : {}),
      ...(kind.success ? { kind: kind.data } : {}),
    });
    return c.json({ documents: docs.map((d) => documentView(repos, d)) });
  });

  app.post("/api/documents", validate("json", GenerateSchema), async (c) => {
    const body = c.req.valid("json");
    const base: RequestDocumentInput = {
      kind: body.kind,
      profileId: body.profileId,
      postingId: body.postingId ?? null,
      instructions: body.instructions ?? null,
      acceptLanguage: body.acceptLanguage,
      templateId: body.templateId,
    };
    try {
      const out: DocumentView[] = [];
      const first = await requestDocument(repos, enqueue, {
        ...base,
        ...(body.kind === "cover_letter" ? { format: body.format } : {}),
      });
      out.push(documentView(repos, first.document));
      if (body.withCoverLetter && body.kind === "cv") {
        const letter = await requestDocument(repos, enqueue, {
          ...base,
          kind: "cover_letter",
          format: body.format,
        });
        out.push(documentView(repos, letter.document));
      }
      for (const v of out) announce(v);
      return c.json({ documents: out }, 202);
    } catch (e) {
      return requestErrorResponse(c, e);
    }
  });

  app.get("/api/documents/:id", (c) => {
    const doc = repos.documents.get(c.req.param("id"));
    return doc ? c.json(documentView(repos, doc)) : notFound(c);
  });

  app.post("/api/documents/:id/regenerate", validate("json", RegenerateSchema), async (c) => {
    const doc = repos.documents.get(c.req.param("id"));
    if (!doc) return notFound(c);
    const body = c.req.valid("json");
    try {
      await requestDocument(repos, enqueue, {
        kind: doc.kind,
        profileId: doc.profileId,
        postingId: doc.postingId,
        instructions: body.instructions ?? null,
        acceptLanguage: body.acceptLanguage,
      });
      const view = documentView(repos, repos.documents.get(doc.id) ?? doc);
      announce(view);
      return c.json(view, 202);
    } catch (e) {
      return requestErrorResponse(c, e);
    }
  });

  // M6: edição na tela (nova versão por cv.render, sem o gerador)
  app.put("/api/documents/:id/content", validate("json", EditSchema), async (c) => {
    const body = c.req.valid("json");
    try {
      await editDocument(repos, enqueue, {
        documentId: c.req.param("id"),
        ...body,
        source: "edit",
      });
    } catch (e) {
      return editErrorResponse(c, e);
    }
    const view = documentView(repos, repos.documents.get(c.req.param("id")) as DocumentRecord);
    announce(view);
    return c.json(view, 202);
  });

  // M6: trocar modelo, papel ou formato da carta (re-render do conteúdo atual, sem tokens do gerador)
  app.patch("/api/documents/:id", validate("json", LayoutSchema), async (c) => {
    try {
      await changeDocumentLayout(repos, enqueue, {
        documentId: c.req.param("id"),
        ...c.req.valid("json"),
      });
    } catch (e) {
      return editErrorResponse(c, e);
    }
    const view = documentView(repos, repos.documents.get(c.req.param("id")) as DocumentRecord);
    announce(view);
    return c.json(view, 202);
  });

  // M6: comparar versões (F05-9, diff de texto)
  app.get("/api/documents/:id/diff", (c) => {
    const doc = repos.documents.get(c.req.param("id"));
    const from = doc ? repos.documents.getVersion(doc.id, Number(c.req.query("from"))) : null;
    const to = doc ? repos.documents.getVersion(doc.id, Number(c.req.query("to"))) : null;
    if (!from?.content || !to?.content) return notFound(c);
    return c.json({
      lines: documentDiff(
        from.content as CvContent | CoverLetterContent,
        to.content as CvContent | CoverLetterContent,
      ),
    });
  });

  app.get("/api/cv-templates", (c) =>
    c.json({
      templates: BUILTIN_TEMPLATES.map((t) => ({
        ...t,
        origin: "builtin" as const,
        status: "valid" as const,
      })),
    }),
  );

  app.get("/api/documents/:id/versions/:n", (c) => {
    const found = versionOf(c);
    return found ? c.json({ version: found.version }) : notFound(c);
  });

  app.get("/api/documents/:id/versions/:n/pdf", (c) => {
    const found = versionOf(c);
    const path = found?.version.pdfPath ? join(deps.dataDir, found.version.pdfPath) : null;
    if (!found || !path || !existsSync(path)) return notFound(c);
    const name = downloadName(repos, documentView(repos, found.doc));
    return c.body(readFileSync(path), 200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  app.get("/api/documents/:id/versions/:n/pages/:p", (c) => {
    const p = c.req.param("p");
    if (!/^\d{1,2}$/.test(p)) return apiError(c, 400, "invalid_page", "Página inválida");
    const found = versionOf(c);
    if (!found) return notFound(c);
    const path = join(
      deps.dataDir,
      `documents/${found.doc.id}/v${found.version.version}/pages/page-${Number(p)}.png`,
    );
    if (!existsSync(path)) return apiError(c, 404, "page_not_found", "Página não encontrada");
    return c.body(readFileSync(path), 200, {
      "content-type": "image/png",
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  app.get("/api/documents/:id/versions/:n/text", (c) => {
    const found = versionOf(c);
    if (!found?.version.textBody) return notFound(c);
    return c.text(found.version.textBody);
  });

  app.delete("/api/documents/:id", (c) => {
    const doc = repos.documents.get(c.req.param("id"));
    if (!doc) return notFound(c);
    repos.notifications.resolveSubject("document", doc.id);
    repos.documents.remove(doc.id);
    rmSync(join(deps.dataDir, "documents", doc.id), { recursive: true, force: true });
    deps.bus?.emit({
      type: "document.updated",
      documentId: doc.id,
      profileId: doc.profileId,
      postingId: doc.postingId,
      status: "deleted",
    });
    return c.body(null, 204);
  });

  return app;
}
