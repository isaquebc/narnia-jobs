/** Estimativa de tokens antes de confirmar a extração (F01 §2.5). Ordem de grandeza; o uso real vem do `result`. */

export const PROMPT_OVERHEAD = {
  document: 600,
  facts: 900,
  digest: 700,
  /** Fatos extraídos entram como entrada da chamada de digest. */
  factsAsInput: 1500,
} as const;

/** Aproximação de custo para o modelo ler uma página de PDF pela tool Read. */
export const TOKENS_PER_PDF_PAGE = 1500;

export interface EstimateInput {
  textChars: number;
  pdfPages?: number;
  models: { document: string; facts: string; digest: string };
  options: { ocr: boolean; modelRead: boolean };
}

export interface CallEstimate {
  model: string;
  tokens: number;
}

export interface ExtractionEstimate {
  calls: { document?: CallEstimate; facts: CallEstimate; digest: CallEstimate };
  totalTokens: number;
  /** Rótulos para a UI: "~6k haiku", "~5k sonnet". */
  labels: string[];
}

export function charsToTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

function label(c: CallEstimate): string {
  return `~${(c.tokens / 1000).toFixed(1).replace(/\.0$/, "")}k ${c.model}`;
}

export function estimateExtraction(input: EstimateInput): ExtractionEstimate {
  const textTokens = charsToTokens(input.textChars);
  const facts: CallEstimate = {
    model: input.models.facts,
    tokens: textTokens + PROMPT_OVERHEAD.facts,
  };
  const digest: CallEstimate = {
    model: input.models.digest,
    tokens:
      textTokens + PROMPT_OVERHEAD.digest + (textTokens > 0 ? PROMPT_OVERHEAD.factsAsInput : 0),
  };
  const calls: ExtractionEstimate["calls"] = { facts, digest };
  if (input.pdfPages && input.pdfPages > 0 && input.options.modelRead) {
    calls.document = {
      model: input.models.document,
      tokens: input.pdfPages * TOKENS_PER_PDF_PAGE + PROMPT_OVERHEAD.document,
    };
  }
  const list = [calls.document, calls.facts, calls.digest].filter((c): c is CallEstimate =>
    Boolean(c),
  );
  return { calls, totalTokens: list.reduce((s, c) => s + c.tokens, 0), labels: list.map(label) };
}
