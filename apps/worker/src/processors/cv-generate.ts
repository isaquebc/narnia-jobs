import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ATS_MIN_SCORE,
  assembleCoverLetter,
  assembleCv,
  atsScore,
  buildCvBrief,
  buildCvHeader,
  checkLink,
  DOCUMENT_MAX_ATTEMPTS,
  DOCUMENT_MODEL_DEFAULTS,
  type DocumentModelKey,
  type DocumentRecord,
  type DocumentVersionRecord,
  type DocumentVersionStatus,
  documentVersionDir,
  formatPeriod,
  inspectPdf,
  isBuiltinTemplate,
  type LinkStatus,
  layoutIssues,
  linkIssues,
  notifyDocumentResult,
  type PdfInspection,
  type RenderPdfResult,
  recordUsage,
  renderDocumentHtml,
  renderPdf,
  renderPdfPages,
  resolveModel,
  sectionLabel,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import type {
  CoverLetterContent,
  CoverLetterDraft,
  CvBrief,
  CvContent,
  CvDraft,
  CvReview,
  CvReviewIssue,
  Paper,
} from "@narnia-jobs/shared";
import type { WorkerDeps } from "../pipeline";
import type { TaskHandler } from "../tasks";

/**
 * Geração do CV e da carta (F05 §2.1, M2): coleta → gerador (Sonnet) → validação da origem e das lacunas → PDF no
 * serviço `browser` → checagens por código (layout, links, ATS) → revisão (M3). Reprovou: uma regeração automática com
 * os apontamentos; reprovou de novo, a versão fica pronta com o alerta (`ready_with_issues`). Carta em texto não vira
 * PDF. As peças que dependem do navegador são injetáveis para os testes.
 */
export interface DocumentDeps {
  browserWs: string | null;
  render?: (html: string, paper: Paper, javaScript: boolean) => Promise<RenderPdfResult>;
  inspect?: (pdf: Uint8Array) => Promise<PdfInspection>;
  checkLink?: (url: string) => Promise<LinkStatus>;
  pages?: (pdfPath: string, outDir: string) => Promise<string[]>;
}

type Doc = CvContent | CoverLetterContent;

const errorsOf = (issues: CvReviewIssue[]) => issues.filter((i) => i.severity === "error");

function documentDeps(deps: WorkerDeps): Required<DocumentDeps> {
  const d: DocumentDeps = deps.documents ?? { browserWs: process.env.NARNIA_BROWSER_WS || null };
  return {
    browserWs: d.browserWs,
    render:
      d.render ??
      ((html, paper, javaScript) =>
        d.browserWs
          ? renderPdf(d.browserWs, html, { paper, javaScript })
          : Promise.resolve({
              ok: false as const,
              message: "Navegador indisponível (NARNIA_BROWSER_WS vazio).",
            })),
    inspect: d.inspect ?? inspectPdf,
    checkLink: d.checkLink ?? ((url) => checkLink(url)),
    pages: d.pages ?? ((pdf, out) => renderPdfPages(pdf, out, { dpi: 110 })),
  };
}

export const cvGenerate: TaskHandler = async (data, ctx, deps) => {
  const { repos } = deps;
  const doc = repos.documents.get(String(data.payload.documentId ?? ""));
  const version = doc ? repos.documents.versionById(String(data.payload.versionId ?? "")) : null;
  if (!doc || !version) return { skipped: "document_not_found" };
  const docs = documentDeps(deps);
  const set = async (
    status: DocumentVersionStatus,
    patch: Parameters<typeof repos.documents.updateVersion>[1] = {},
  ) => {
    const v = repos.documents.updateVersion(version.id, { ...patch, status });
    await deps.publish({
      type: "document.updated",
      documentId: doc.id,
      profileId: doc.profileId,
      postingId: doc.postingId,
      status,
    });
    return v;
  };
  const model = (key: DocumentModelKey) =>
    resolveModel(repos.settings, key, DOCUMENT_MODEL_DEFAULTS[key]);
  const usage: unknown[] = [];
  // cv.render (F05-11): alteração do recrutador (ou edição na tela) chega pronta; uma tentativa, sem o gerador
  const edit =
    (data.payload.cv as CvDraft | undefined) ??
    (data.payload.letter as CoverLetterDraft | undefined) ??
    null;
  const maxAttempts = edit ? 1 : DOCUMENT_MAX_ATTEMPTS;
  try {
    await set("collecting", { jobId: ctx.jobId });
    const header = buildCvHeader(repos, doc.profileId, doc.locale);
    let previous: CvBrief["previousIssues"] = [];
    let last: {
      content: Doc;
      review: CvReview;
      pdfPath: string | null;
      pages: number | null;
      text: string | null;
    } | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) await set("retrying", { attempts: attempt - 1 });
      const { brief, atsTerms } = buildCvBrief(repos, {
        kind: doc.kind,
        profileId: doc.profileId,
        postingId: doc.postingId,
        locale: doc.locale,
        instructions: version.instructions,
        previousIssues: previous,
      });
      if (!edit) {
        await set("generating", { attempts: attempt });
        await ctx.progress(10 + (attempt - 1) * 45, "generating");
      } else repos.documents.updateVersion(version.id, { attempts: 1 });
      const genModel = model("cv_generate");
      const meta = {
        locale: doc.locale,
        paper: doc.paper,
        profileId: doc.profileId,
        postingId: doc.postingId,
        generatedAt: new Date().toISOString(),
      };
      let assembled: { content: Doc; issues: CvReviewIssue[] };
      if (edit && doc.kind === "cover_letter")
        assembled = assembleCoverLetter(brief, edit as CoverLetterDraft, {
          meta: { ...meta, postingId: doc.postingId ?? "", format: doc.format },
          header,
        });
      else if (edit) assembled = assembleCv(repos, brief, edit as CvDraft, { meta, header });
      else if (doc.kind === "cover_letter") {
        const r = await deps.provider.coverLetterGenerate({ brief, model: genModel });
        usage.push(
          recordUsage(
            repos,
            deps.dataDir,
            usageFromSdkResult(r.sdk, {
              category: "cover_letter.generate",
              model: genModel,
              jobId: ctx.jobId,
            }),
          ),
        );
        assembled = assembleCoverLetter(brief, r.output, {
          meta: { ...meta, postingId: doc.postingId ?? "", format: doc.format },
          header,
        });
      } else {
        const r = await deps.provider.cvGenerate({ brief, model: genModel });
        usage.push(
          recordUsage(
            repos,
            deps.dataDir,
            usageFromSdkResult(r.sdk, {
              category: "cv.generate",
              model: genModel,
              jobId: ctx.jobId,
            }),
          ),
        );
        assembled = assembleCv(repos, brief, r.output, { meta, header });
      }
      await set("validating", { content: assembled.content });
      const finalAttempt = attempt === maxAttempts;
      // origem inválida ou termo sem evidência: regera antes de gastar o navegador (na última tentativa, monta mesmo assim)
      if (errorsOf(assembled.issues).length > 0 && !finalAttempt) {
        previous = errorsOf(assembled.issues).map(({ area, message, where }) => ({
          area,
          message,
          where,
        }));
        last = {
          content: assembled.content,
          review: { passed: false, atsScore: null, issues: assembled.issues },
          pdfPath: null,
          pages: null,
          text: null,
        };
        continue;
      }
      const rendered = await renderAndCheck(
        deps,
        docs,
        doc,
        version,
        assembled.content,
        atsTerms,
        brief,
      );
      const issues = [...assembled.issues, ...rendered.issues];
      // revisão do Haiku (F05-13): quando o código já reprovou, só na última tentativa (a regeração vem de qualquer jeito)
      if (errorsOf(issues).length === 0 || finalAttempt) {
        await set("reviewing");
        await ctx.progress(40 + (attempt - 1) * 45, "reviewing");
        const reviewModel = model("cv_review");
        const rv = await deps.provider.cvReview({
          dir: rendered.dir,
          pageFiles: rendered.pageFiles,
          brief,
          content: assembled.content,
          pdfText: rendered.pdfText,
          checks: issues.map(({ area, severity, message }) => ({ area, severity, message })),
          model: reviewModel,
        });
        usage.push(
          recordUsage(
            repos,
            deps.dataDir,
            usageFromSdkResult(rv.sdk, {
              category: "cv.review",
              model: reviewModel,
              jobId: ctx.jobId,
            }),
          ),
        );
        issues.push(...rv.output.issues);
      }
      const review: CvReview = {
        passed: errorsOf(issues).length === 0,
        atsScore: rendered.atsScore,
        issues,
      };
      last = {
        content: assembled.content,
        review,
        pdfPath: rendered.pdfPath,
        pages: rendered.pages,
        text: rendered.text,
      };
      if (review.passed) break;
      previous = errorsOf(issues).map(({ area, message, where }) => ({ area, message, where }));
    }
    const final = last as NonNullable<typeof last>;
    const status: DocumentVersionStatus = final.review.passed ? "ready" : "ready_with_issues";
    await set(status, {
      content: final.content,
      review: final.review,
      atsScore: final.review.atsScore,
      pdfPath: final.pdfPath,
      pagesRendered: final.pages,
      textBody: final.text,
      usage,
    });
    const notice = notifyDocumentResult(repos, doc, status === "ready");
    await deps.publish({
      type: notice.created ? "notification.created" : "notification.updated",
      notification: notice.notification,
    });
    return {
      documentId: doc.id,
      version: version.version,
      status,
      attempts: repos.documents.versionById(version.id)?.attempts,
    };
  } catch (e) {
    await set("error", { error: (e as Error).message, usage });
    return { documentId: doc.id, error: (e as Error).message };
  }
};

async function renderAndCheck(
  deps: WorkerDeps,
  docs: Required<DocumentDeps>,
  doc: DocumentRecord,
  version: DocumentVersionRecord,
  content: Doc,
  atsTerms: ReturnType<typeof buildCvBrief>["atsTerms"],
  brief: CvBrief,
): Promise<{
  issues: CvReviewIssue[];
  atsScore: number | null;
  pdfPath: string | null;
  pages: number | null;
  text: string | null;
  /** Pasta da versão (o revisor lê as páginas dali), páginas em PNG relativas a ela e o texto do documento. */
  dir: string;
  pageFiles: string[];
  pdfText: string;
}> {
  const letter = content.meta.kind === "cover_letter" ? (content as CoverLetterContent) : null;
  const letterText = letter
    ? [letter.greeting, ...letter.paragraphs.map((p) => p.text), letter.signature].join("\n\n")
    : null;
  const dir = documentVersionDir(doc.id, version.version);
  const abs = join(deps.dataDir, dir);
  mkdirSync(join(abs, "pages"), { recursive: true });
  if (doc.kind === "cover_letter" && doc.format === "text")
    return {
      issues: [],
      atsScore: null,
      pdfPath: null,
      pages: null,
      text: letterText,
      dir: abs,
      pageFiles: [],
      pdfText: letterText ?? "",
    };
  const templateId = isBuiltinTemplate(doc.templateId) ? doc.templateId : "classico";
  const html = renderDocumentHtml(content, templateId);
  const r = await docs.render(html, doc.paper, true);
  if (!r.ok) throw new Error(`Não consegui montar o PDF: ${r.message}`);
  const file = doc.kind === "cv" ? "cv.pdf" : "carta.pdf";
  writeFileSync(join(abs, file), r.pdf);
  writeFileSync(join(abs, "render.html"), html);
  const pngs = await docs.pages(join(abs, file), join(abs, "pages")).catch(() => [] as string[]);

  const insp = await docs.inspect(r.pdf);
  const cv = content.meta.kind === "cv" ? (content as CvContent) : null;
  const headings = cv ? cv.sectionsOrder.map((s) => sectionLabel(doc.locale, s)) : [];
  const issues = layoutIssues(insp, { headings });
  const expected = [
    ...content.header.links.map((l) => l.url),
    ...(cv?.projects.flatMap((p) => (p.url ? [p.url] : [])) ?? []),
  ];
  const statuses = new Map<string, LinkStatus>();
  for (const url of [...new Set(expected)]) statuses.set(url, await docs.checkLink(url));
  issues.push(...linkIssues(insp, expected, statuses));
  let ats: number | null = null;
  if (cv) {
    const a = atsScore({
      text: insp.text,
      headings,
      contact: { email: cv.header.email, phone: cv.header.phone },
      contentLines: [cv.summary, ...cv.experiences.flatMap((e) => e.bullets.map((b) => b.text))],
      periods: cv.experiences.map((e) => formatPeriod(doc.locale, e.start, e.end)).filter(Boolean),
      terms: atsTerms,
    });
    ats = a.score;
    if (a.score < ATS_MIN_SCORE)
      issues.push({
        area: "ats",
        severity: "error",
        message: `Aderência a ATS de ${a.score}% (mínimo ${ATS_MIN_SCORE}%).${a.missing.length ? ` Faltam no texto: ${a.missing.join(", ")}.` : ""}`,
        where: null,
      });
    if (brief.gaps.length)
      issues.push({
        area: "ats",
        severity: "warning",
        message: `A vaga pede ${brief.gaps.join(", ")}, sem registro nos seus dados.`,
        where: null,
      });
  }
  return {
    issues,
    atsScore: ats,
    pdfPath: `${dir}/${file}`,
    pages: insp.pages.length,
    text: letterText,
    dir: abs,
    pageFiles: pngs.map((p) => relative(abs, p)),
    pdfText: insp.text,
  };
}
