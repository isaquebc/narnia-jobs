import { z } from "zod";
import { EvidenceIdSchema } from "./analysis";
import { IdSchema, IsoDateTimeSchema, PartialDateSchema } from "./common";

/**
 * Conteúdo do CV e da carta de apresentação (F05 §2.2). O modelo nunca escreve HTML: o gerador escolhe e redige os
 * bullets com a origem (`factIds`), e o código preenche cabeçalho, empresa, cargo e datas a partir dos dados da
 * pessoa. O template (padrão ou do usuário) transforma este JSON em HTML e o navegador em PDF.
 */
export const DOCUMENT_KINDS = ["cv", "cover_letter"] as const;
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

export const CV_LOCALES = ["pt-BR", "en-US"] as const;
export const CvLocaleSchema = z.enum(CV_LOCALES);
export type CvLocale = z.infer<typeof CvLocaleSchema>;

export const PaperSchema = z.enum(["A4", "Letter"]);
export type Paper = z.infer<typeof PaperSchema>;

export const CV_LINK_KINDS = [
  "email",
  "whatsapp",
  "linkedin",
  "github",
  "portfolio",
  "other",
] as const;
export const CvLinkKindSchema = z.enum(CV_LINK_KINDS);
export type CvLinkKind = z.infer<typeof CvLinkKindSchema>;

/** Link clicável do PDF (F05-19): só http(s), `mailto:` ou WhatsApp. */
export const CvLinkSchema = z.object({
  kind: CvLinkKindSchema,
  url: z.string().regex(/^(https?:\/\/|mailto:)\S+$/i, "Link http(s) ou mailto:"),
  label: z.string().trim().min(1),
});
export type CvLink = z.infer<typeof CvLinkSchema>;

export const CvHeaderSchema = z.object({
  name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  location: z.string().trim().min(1).nullable(),
  email: z.string().trim().min(1).nullable(),
  phone: z.string().trim().min(1).nullable(),
  links: z.array(CvLinkSchema),
});
export type CvHeader = z.infer<typeof CvHeaderSchema>;

const Text = z.string().trim().min(1);
const Sourced = z
  .array(EvidenceIdSchema)
  .min(1, "Todo item do CV precisa da origem nos dados da pessoa.");
const MatchScore = z.number().int().min(0).max(100);

export const CvBulletSchema = z.object({ text: Text, factIds: Sourced });
export type CvBullet = z.infer<typeof CvBulletSchema>;

export const CV_SECTIONS = [
  "summary",
  "experience",
  "skills",
  "projects",
  "education",
  "languages",
] as const;
export const CvSectionSchema = z.enum(CV_SECTIONS);
export type CvSection = z.infer<typeof CvSectionSchema>;

export const CvMetaSchema = z.object({
  kind: DocumentKindSchema,
  locale: CvLocaleSchema,
  paper: PaperSchema,
  profileId: IdSchema,
  postingId: IdSchema.nullable(),
  generatedAt: IsoDateTimeSchema,
});

export const CvContentSchema = z.object({
  meta: CvMetaSchema.extend({ kind: z.literal("cv") }),
  header: CvHeaderSchema,
  summary: Text,
  experiences: z.array(
    z.object({
      factId: IdSchema,
      company: Text,
      title: Text,
      start: PartialDateSchema.nullable(),
      end: PartialDateSchema.nullable(),
      location: Text.nullable(),
      bullets: z.array(CvBulletSchema),
      tech: z.array(Text),
      matchScore: MatchScore,
    }),
  ),
  skills: z.array(
    z.object({
      label: Text,
      items: z.array(z.object({ name: Text, factIds: Sourced, matchScore: MatchScore })).min(1),
    }),
  ),
  projects: z.array(
    z.object({
      factId: IdSchema,
      name: Text,
      description: Text.nullable(),
      url: z.url().nullable(),
      tech: z.array(Text),
    }),
  ),
  education: z.array(
    z.object({
      factId: IdSchema,
      institution: Text,
      course: Text.nullable(),
      degree: Text.nullable(),
      start: PartialDateSchema.nullable(),
      end: PartialDateSchema.nullable(),
    }),
  ),
  languages: z.array(z.object({ factId: IdSchema, name: Text, level: Text })),
  /** Termo pedido pela vaga sem evidência × experiência próxima mostrada com o nome verdadeiro (F05-20). */
  adjacent: z.array(z.object({ asked: Text, shown: Text, factIds: Sourced })),
  sectionsOrder: z.array(CvSectionSchema).min(1),
  /** Experiências fora do PDF por pouca aderência: roteiro para aprofundar na entrevista (F05-15). */
  omitted: z.array(
    z.object({
      factId: IdSchema,
      company: Text,
      title: Text,
      reason: Text,
      matchScore: MatchScore,
    }),
  ),
  provenance: z.object({
    factIdsUsed: z.array(EvidenceIdSchema),
    unverifiedFactIds: z.array(EvidenceIdSchema),
  }),
});
export type CvContent = z.infer<typeof CvContentSchema>;

export const COVER_LETTER_MIN_WORDS = 250;
export const COVER_LETTER_MAX_WORDS = 400;
export const CoverLetterFormatSchema = z.enum(["text", "pdf"]);
export type CoverLetterFormat = z.infer<typeof CoverLetterFormatSchema>;

const CoverLetterParagraphSchema = z
  .object({
    role: z.enum(["why", "covers", "gaps", "closing"]),
    text: Text,
    factIds: z.array(EvidenceIdSchema),
  })
  .refine((p) => p.role !== "covers" || p.factIds.length > 0, {
    message: "O parágrafo do que a pessoa cobre precisa da origem nos dados.",
    path: ["factIds"],
  });

export function coverLetterWordCount(letter: { paragraphs: { text: string }[] }): number {
  return letter.paragraphs.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);
}

export const CoverLetterContentSchema = z
  .object({
    meta: CvMetaSchema.extend({
      kind: z.literal("cover_letter"),
      postingId: IdSchema,
      format: CoverLetterFormatSchema,
    }),
    header: CvHeaderSchema,
    greeting: Text,
    paragraphs: z.array(CoverLetterParagraphSchema).min(2),
    signature: Text,
  })
  .refine(
    (l) => {
      const n = coverLetterWordCount(l);
      return n >= COVER_LETTER_MIN_WORDS && n <= COVER_LETTER_MAX_WORDS;
    },
    { message: `A carta tem de ${COVER_LETTER_MIN_WORDS} a ${COVER_LETTER_MAX_WORDS} palavras.` },
  );
export type CoverLetterContent = z.infer<typeof CoverLetterContentSchema>;

export const CV_REVIEW_AREAS = [
  "links",
  "relevance",
  "hallucination",
  "facts",
  "layout",
  "ats",
  "language",
  "pages",
  "contact",
] as const;
export const CvReviewIssueSchema = z.object({
  area: z.enum(CV_REVIEW_AREAS),
  severity: z.enum(["error", "warning"]),
  message: Text,
  /** Onde no documento (seção, empresa, página); null quando é do documento inteiro. */
  where: Text.nullable(),
});
export type CvReviewIssue = z.infer<typeof CvReviewIssueSchema>;

/** Resultado da revisão (F05-13): checagens por código + leitura do revisor; reprova com qualquer `error`. */
export const CvReviewSchema = z.object({
  passed: z.boolean(),
  atsScore: z.number().min(0).max(100).nullable(),
  issues: z.array(CvReviewIssueSchema),
});
export type CvReview = z.infer<typeof CvReviewSchema>;
