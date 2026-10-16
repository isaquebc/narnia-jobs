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

/* ---------- gerador (F05-11): o que o modelo recebe e devolve ---------- */

/** Resumo montado pelo código para o gerador: fatos já filtrados (sem ocultos) e ordenados pelo score de match. */
export interface CvBrief {
  kind: DocumentKind;
  locale: CvLocale;
  maxPages: 2;
  profile: {
    name: string;
    targetTitle: string;
    seniority: string;
    area: string;
    pitch: string | null;
  };
  posting: null | {
    company: string | null;
    client: string | null;
    title: string | null;
    seniority: string | null;
    required: string[];
    nice: string[];
    responsibilities: string[];
    analysis: null | {
      summary: string;
      matches: Array<{ requirement: string; evidence: Array<{ kind: string; id: string }> }>;
      gaps: string[];
      atsKeywordsMissing: string[];
      cvImprovements: string[];
    };
  };
  experiences: Array<{
    id: string;
    company: string;
    title: string;
    start: string | null;
    end: string | null;
    current: boolean;
    summary: string | null;
    tech: string[];
    matchScore: number;
    achievements: Array<{ id: string; text: string; metric: string | null; highlight: boolean }>;
  }>;
  /** Experiências fora do PDF (roteiro de entrevista): o gerador não escreve sobre elas. */
  omitted: Array<{ id: string; company: string; title: string; reason: string }>;
  skills: Array<{ id: string; name: string; category: string | null; matchScore: number }>;
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    tech: string[];
    matchScore: number;
  }>;
  education: Array<{
    id: string;
    institution: string;
    course: string | null;
    degree: string | null;
  }>;
  languages: Array<{ id: string; name: string; level: string }>;
  /** Termos da vaga sem evidência nos dados: nunca escritos no CV; adjacência só com o nome verdadeiro (F05-20). */
  gaps: string[];
  instructions: string | null;
  /** Apontamentos da revisão anterior (regeração automática, F05-13). */
  previousIssues: Array<{ area: string; message: string; where: string | null }>;
}

export const CvDraftSchema = z.object({
  /** Cargo-alvo no idioma do documento (o mesmo cargo do perfil, traduzido quando preciso). */
  headline: Text,
  summary: Text,
  experiences: z.array(
    z.object({
      factId: IdSchema,
      /** Cargo e local como nos dados, traduzidos para o idioma do documento quando preciso (mesmo significado). */
      title: Text,
      location: Text.nullable(),
      bullets: z.array(CvBulletSchema).min(1).max(6),
      tech: z.array(Text).max(12),
    }),
  ),
  /** Curso e grau no idioma do documento, para cada formação do resumo. */
  education: z.array(
    z.object({ factId: IdSchema, course: Text.nullable(), degree: Text.nullable() }),
  ),
  skills: z.array(
    z.object({ label: Text, items: z.array(z.object({ name: Text, factIds: Sourced })).min(1) }),
  ),
  projects: z.array(z.object({ factId: IdSchema, description: Text })),
  adjacent: z.array(z.object({ asked: Text, shown: Text, factIds: Sourced })),
  sectionsOrder: z.array(CvSectionSchema).min(1),
});
export type CvDraft = z.infer<typeof CvDraftSchema>;

export const CoverLetterDraftSchema = z.object({
  greeting: Text,
  paragraphs: z
    .array(
      z.object({
        role: z.enum(["why", "covers", "gaps", "closing"]),
        text: Text,
        factIds: z.array(EvidenceIdSchema),
      }),
    )
    .min(3)
    .max(5),
});
export type CoverLetterDraft = z.infer<typeof CoverLetterDraftSchema>;

/** Saída do revisor (F05-13, Haiku): o que só a leitura acha. Links, páginas, fonte, espaçamento e ATS são do código. */
export const CV_MODEL_REVIEW_AREAS = [
  "relevance",
  "hallucination",
  "facts",
  "layout",
  "language",
  "contact",
] as const;
export const CvReviewOutputSchema = z.object({
  passed: z.boolean(),
  issues: z.array(
    z.object({
      area: z.enum(CV_MODEL_REVIEW_AREAS),
      severity: z.enum(["error", "warning"]),
      message: Text,
      where: Text.nullable(),
    }),
  ),
});
export type CvReviewOutput = z.infer<typeof CvReviewOutputSchema>;
