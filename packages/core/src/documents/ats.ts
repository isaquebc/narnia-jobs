import { normalizeTerm } from "../postings/dictionary";

/**
 * Aderência a ATS (F05-20, mínimo 90 na revisão): leitura do PDF como um sistema de triagem lê (30 pontos) + termos da
 * vaga presentes no texto (70 pontos), contados **só sobre os termos com evidência** nos dados da pessoa. Lacunas reais
 * (termo sem evidência) não derrubam a nota e vão para o aviso; a experiência adjacente não vale como o termo.
 */
export interface AtsTerm {
  term: string;
  aliases: string[];
  /** Exigido 2, desejável 1. */
  weight: number;
  hasEvidence: boolean;
}

export interface AtsInput {
  text: string;
  headings: string[];
  contact: { email: string | null; phone: string | null };
  /** Textos do conteúdo (bullets, resumo) que precisam sair como texto, não imagem. */
  contentLines: string[];
  /** Períodos formatados como o template escreve. */
  periods: string[];
  terms: AtsTerm[];
}

export interface AtsResult {
  score: number;
  reading: number;
  matched: string[];
  /** Com evidência e fora do texto: derrubam a nota. */
  missing: string[];
  /** Sem evidência nos dados: só aviso. */
  gaps: string[];
}

export const ATS_MIN_SCORE = 90;
const READING_POINTS = 30;
const TERMS_POINTS = 70;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Termo (ou sinônimo) no texto, com fronteira de letra/dígito dos dois lados. */
export function termInText(names: string[], text: string): boolean {
  const hay = normalizeTerm(text);
  return names.some((n) => {
    const k = normalizeTerm(n);
    return (
      k.length > 0 &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(k)}(?![\\p{L}\\p{N}])`, "u").test(hay)
    );
  });
}

const squash = (s: string) => normalizeTerm(s).replace(/\s+/g, "");

export function atsScore(input: AtsInput): AtsResult {
  const text = input.text;
  const flat = squash(text);
  const checks = [
    text.replace(/\s/g, "").length >= 200,
    input.headings.every((h) => termInText([h], text)),
    Boolean(
      (input.contact.email && text.includes(input.contact.email)) ||
        (input.contact.phone && flat.includes(squash(input.contact.phone))),
    ),
    input.contentLines.length === 0 ||
      input.contentLines.filter((l) => flat.includes(squash(l))).length /
        input.contentLines.length >=
        0.9,
    input.periods.every((p) => flat.includes(squash(p))),
  ];
  const reading = (READING_POINTS * checks.filter(Boolean).length) / checks.length;
  const evidenced = input.terms.filter((t) => t.hasEvidence);
  const found = (t: AtsTerm) => termInText([t.term, ...t.aliases], text);
  const matched = evidenced.filter(found);
  const missing = evidenced.filter((t) => !found(t));
  const total = evidenced.reduce((n, t) => n + t.weight, 0);
  const score =
    total === 0
      ? (reading / READING_POINTS) * 100
      : reading + (TERMS_POINTS * matched.reduce((n, t) => n + t.weight, 0)) / total;
  return {
    score: Math.round(score),
    reading: Math.round(reading),
    matched: matched.map((t) => t.term),
    missing: missing.map((t) => t.term),
    gaps: input.terms.filter((t) => !t.hasEvidence).map((t) => t.term),
  };
}
