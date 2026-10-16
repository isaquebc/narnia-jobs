import {
  type CoverLetterContent,
  type CoverLetterDraft,
  CV_TOOLS,
  type CvContent,
  type CvDraft,
  type CvToolName,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import type { DocumentRecord } from "../db/repos/documents";
import { contentToDraft, DocumentEditError, editDocument } from "./edit";
import { documentUrl } from "./notify";
import {
  DocumentRequestError,
  documentStale,
  type EnqueueDocumentTask,
  requestDocument,
} from "./request";

/**
 * Handlers das tools do CV (F05 §2.8). `cv.generate` usa o mesmo pedido do botão; idioma não coberto não é erro: volta
 * como `needs_language_confirmation` para o recrutador perguntar. `cv.edit` cria uma versão com o conteúdo alterado e
 * enfileira `cv.render` (monta, confere e revisa sem o gerador). `ui.suggest_action` só devolve ação com ids que existem.
 */
type In<N extends CvToolName> = z.infer<(typeof CV_TOOLS)[N]["input"]>;
type Out<N extends CvToolName> = z.infer<(typeof CV_TOOLS)[N]["output"]>;
export type CvToolHandlers = { [N in CvToolName]: (input: unknown) => Promise<Out<N>> };

export interface CvToolPorts {
  enqueue: EnqueueDocumentTask;
  /** Documento criado ou com versão nova: a api avisa a web (`document.updated`). */
  changed?(doc: DocumentRecord, status: string): void;
}

export class CvToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function line(repos: Repos, doc: DocumentRecord) {
  const current = repos.documents.currentVersion(doc.id);
  return {
    documentId: doc.id,
    kind: doc.kind,
    profileId: doc.profileId,
    postingId: doc.postingId,
    version: current?.version ?? 0,
    status: current?.status ?? "queued",
    url: documentUrl(doc),
  };
}

/** Conteúdo montado → o formato que o recrutador edita (o mesmo do gerador). */
export const contentToCvDraft = (c: CvContent): CvDraft =>
  (contentToDraft(c) as { cv: CvDraft }).cv;
export const contentToLetterDraft = (c: CoverLetterContent): CoverLetterDraft =>
  (contentToDraft(c) as { letter: CoverLetterDraft }).letter;

export function createCvTools(repos: Repos, ctx: { ports: CvToolPorts }): CvToolHandlers {
  const wrap = <N extends CvToolName>(
    name: N,
    impl: (input: In<N>) => Out<N> | Promise<Out<N>>,
  ) => {
    const def = CV_TOOLS[name];
    return async (raw: unknown): Promise<Out<N>> =>
      def.output.parse(await impl(def.input.parse(raw) as In<N>)) as Out<N>;
  };
  const must = (id: string) => {
    const d = repos.documents.get(id);
    if (!d) throw new CvToolError("document_not_found", `Documento não encontrado: ${id}`);
    return d;
  };

  return {
    "cv.generate": wrap("cv.generate", async (i) => {
      const base = {
        profileId: i.profileId,
        postingId: i.postingId ?? null,
        instructions: i.instructions ?? null,
        acceptLanguage: i.acceptLanguage,
        source: "recruiter" as const,
      };
      try {
        const docs: DocumentRecord[] = [];
        docs.push(
          (
            await requestDocument(repos, ctx.ports.enqueue, {
              ...base,
              kind: i.kind,
              format: i.format,
            })
          ).document,
        );
        if (i.withCoverLetter && i.kind === "cv")
          docs.push(
            (
              await requestDocument(repos, ctx.ports.enqueue, {
                ...base,
                kind: "cover_letter",
                format: i.format,
              })
            ).document,
          );
        for (const d of docs) ctx.ports.changed?.(d, "queued");
        return {
          status: "queued" as const,
          documents: docs.map((d) => line(repos, d)),
          language: null,
          message: "Gerando em segundo plano; o andamento aparece na bandeja.",
        };
      } catch (e) {
        if (e instanceof DocumentRequestError && e.code === "language_not_covered")
          return {
            status: "needs_language_confirmation" as const,
            documents: [],
            language: e.language,
            message: e.message,
          };
        if (e instanceof DocumentRequestError) throw new CvToolError(e.code, e.message);
        throw e;
      }
    }),
    "cv.get": wrap("cv.get", (i) => {
      const doc = i.documentId
        ? must(i.documentId)
        : i.kind && i.profileId
          ? repos.documents.find(i.kind, i.profileId, i.postingId ?? null)
          : null;
      if (!doc) return { document: null, review: null, stale: null, draft: null };
      const current = repos.documents.currentVersion(doc.id);
      const content = current?.content as CvContent | CoverLetterContent | null | undefined;
      return {
        document: line(repos, doc),
        review: current?.review ?? null,
        stale: current ? documentStale(repos, doc, current) : null,
        draft: content
          ? content.meta.kind === "cv"
            ? { cv: contentToCvDraft(content as CvContent) }
            : { letter: contentToLetterDraft(content as CoverLetterContent) }
          : null,
      };
    }),
    "cv.edit": wrap("cv.edit", async (i) => {
      must(i.documentId);
      try {
        await editDocument(repos, ctx.ports.enqueue, {
          documentId: i.documentId,
          baseVersion: i.baseVersion,
          cv: i.cv,
          letter: i.letter,
          source: "recruiter",
        });
      } catch (e) {
        if (e instanceof DocumentEditError)
          throw new CvToolError(
            e.code,
            e.code === "conflict" ? `${e.message} Leia de novo com cv.get.` : e.message,
          );
        throw e;
      }
      const updated = repos.documents.get(i.documentId) as DocumentRecord;
      ctx.ports.changed?.(updated, "queued");
      return line(repos, updated);
    }),
    "cv.list": wrap("cv.list", (i) => ({
      documents: repos.documents
        .list({
          ...(i.profileId ? { profileId: i.profileId } : {}),
          ...(i.postingId ? { postingId: i.postingId } : {}),
        })
        .map((d) => line(repos, d)),
    })),
    "ui.suggest_action": wrap("ui.suggest_action", (i) => {
      const p = i.params;
      if (i.action === "document.open") {
        const doc = must(p.documentId ?? "");
        return {
          action: i.action,
          label: i.label,
          params: { documentId: doc.id },
          url: documentUrl(doc),
        };
      }
      if (!p.kind || !p.profileId || !repos.profiles.get(p.profileId))
        throw new CvToolError(
          "invalid_action",
          "Para gerar, informe o tipo e um perfil que existe.",
        );
      if (p.postingId && !repos.postings.get(p.postingId))
        throw new CvToolError("invalid_action", "A vaga informada não existe.");
      if (p.kind === "cover_letter" && !p.postingId)
        throw new CvToolError("invalid_action", "A carta é feita para uma vaga.");
      const url = p.postingId
        ? `/vagas/${p.postingId}?gerar=${p.kind}&perfil=${p.profileId}`
        : `/perfis/${p.profileId}/curriculo?gerar=1`;
      return {
        action: i.action,
        label: i.label,
        params: { kind: p.kind, profileId: p.profileId, postingId: p.postingId ?? null },
        url,
      };
    }),
  };
}
