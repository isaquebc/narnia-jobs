import {
  checkVerdicts,
  cvFactIds,
  cvNoGapTerms,
  type EvalParams,
  type EvalResult,
  jsonSchema,
  language,
  literalQuotes,
  noInventedYears,
  pickFilesLimits,
  referenceCoverage,
  supportingIds,
} from "@narnia-jobs/core";
import { STRUCTURED_PROMPTS, type StructuredOperation } from "@narnia-jobs/providers";

/**
 * Avaliadores de código por prompt estruturado (M3): o padrão de entrega de cada chamada, escrito como regra. Cada um
 * é um módulo do core (`module`, função `fn`) com uma configuração; no Phoenix vira o avaliador `<prompt>-<nome>`,
 * versionado e preso ao dataset do prompt.
 */
export interface PromptEvaluatorDef {
  operation: StructuredOperation;
  /** Nome da avaliação (anotação) no Phoenix. */
  name: string;
  /** Nome do avaliador no Phoenix. */
  phoenixName: string;
  description: string;
  /** Arquivo do módulo em `packages/core/src/evals/prompt-evaluators/`. */
  module: string;
  /** Função exportada pelo módulo. */
  fn: string;
  config: unknown;
  run(p: EvalParams): EvalResult;
}

type Rule = Omit<PromptEvaluatorDef, "operation" | "phoenixName" | "run"> & {
  impl: (p: EvalParams, config: never) => EvalResult;
};

const schemaRule = (op: StructuredOperation): Rule => ({
  name: "json_schema",
  description: "A resposta é JSON e segue o schema de saída do prompt.",
  module: "json-schema",
  fn: "jsonSchema",
  config: { schema: STRUCTURED_PROMPTS[op].jsonSchema },
  impl: jsonSchema as Rule["impl"],
});
const quotes = (sourceFields: string[]): Rule => ({
  name: "citacoes_literais",
  description:
    "Anti-alucinação: toda citação (evidence.quote) aparece literalmente na fonte do exemplo.",
  module: "literal-quotes",
  fn: "literalQuotes",
  config: { sourceFields },
  impl: literalQuotes as Rule["impl"],
});
const years = (sourceFields: string[]): Rule => ({
  name: "sem_anos_inventados",
  description: "Anos citados na resposta existem na fonte do exemplo.",
  module: "no-invented-years",
  fn: "noInventedYears",
  config: { sourceFields },
  impl: noInventedYears as Rule["impl"],
});
const lang = (fields: string[]): Rule => ({
  name: "idioma",
  description: "Com locale pt-*, os textos livres da resposta saem em português.",
  module: "language",
  fn: "language",
  config: { fields },
  impl: language as Rule["impl"],
});
const coverage = (min: number): Rule => ({
  name: "cobertura_da_referencia",
  description:
    "A resposta traz os termos esperados do exemplo (empresas, cargos, skills…), a partir do mínimo.",
  module: "reference-coverage",
  fn: "referenceCoverage",
  config: { min },
  impl: referenceCoverage as Rule["impl"],
});

const cvIds: Rule = {
  name: "origens_do_resumo",
  description: "F05: toda origem citada (factId, factIds) existe no resumo enviado ao gerador.",
  module: "cv-honesty",
  fn: "cvFactIds",
  config: null,
  impl: cvFactIds as Rule["impl"],
};
const cvGaps: Rule = {
  name: "sem_termo_sem_evidencia",
  description:
    "F05-20: nenhum termo da vaga sem evidência no texto (na carta, só no parágrafo das lacunas).",
  module: "cv-honesty",
  fn: "cvNoGapTerms",
  config: null,
  impl: cvNoGapTerms as Rule["impl"],
};

const RULES: Record<StructuredOperation, (op: StructuredOperation) => Rule[]> = {
  readDocument: (op) => [schemaRule(op), coverage(0.8)],
  extractFacts: (op) => [schemaRule(op), quotes(["text"]), years(["text"]), coverage(0.8)],
  buildDigest: (op) => [
    schemaRule(op),
    years(["text"]),
    lang(["summary", "title", "body", "content"]),
  ],
  analyzeProfiles: (op) => [
    schemaRule(op),
    {
      name: "ids_de_apoio",
      description: "As sugestões só citam ids (supportingFactIds) que estão no histórico enviado.",
      module: "supporting-ids",
      fn: "supportingIds",
      config: null,
      impl: supportingIds as Rule["impl"],
    },
    lang(["rationale", "title", "area"]),
    coverage(0.5),
  ],
  pickFiles: (op) => [
    schemaRule(op),
    {
      name: "limite_de_arquivos",
      description:
        "No máximo max_files arquivos e só caminhos que existem na árvore do repositório.",
      module: "pick-files",
      fn: "pickFilesLimits",
      config: null,
      impl: pickFilesLimits as Rule["impl"],
    },
    coverage(0),
  ],
  analyzeRepo: (op) => [schemaRule(op), quotes(["context"]), years(["context"]), coverage(0.6)],
  synthesizeRun: (op) => [
    schemaRule(op),
    quotes(["reports", "metrics_table"]),
    years(["reports", "metrics_table"]),
    lang(["summary", "rationale"]),
    coverage(0.5),
  ],
  checkProposals: (op) => [
    schemaRule(op),
    {
      name: "veredito_por_item",
      description:
        "Um veredito por proposta enviada; com referência, a fração de vereditos certos.",
      module: "check-verdicts",
      fn: "checkVerdicts",
      config: null,
      impl: checkVerdicts as Rule["impl"],
    },
  ],
  chatTitle: (op) => [schemaRule(op), lang(["title"]), coverage(1)],
  // F06: sem anos inventados e com os termos esperados (nada de cidade, moeda ou faixa que a vaga não diz)
  postingExtract: (op) => [schemaRule(op), years(["text"]), coverage(0.8)],
  postingMerge: (op) => [schemaRule(op), years(["text"]), coverage(0.75)],
  postingDuplicate: (op) => [schemaRule(op), lang(["rationale"]), coverage(1)],
  cvGenerate: (op) => [
    schemaRule(op),
    cvIds,
    cvGaps,
    lang(["summary", "text", "label"]),
    coverage(0.75),
  ],
  coverLetterGenerate: (op) => [
    schemaRule(op),
    cvIds,
    cvGaps,
    lang(["greeting", "text"]),
    coverage(0.5),
  ],
};

export const PROMPTS_WITH_EVALUATORS = Object.keys(RULES) as StructuredOperation[];

export function promptEvaluators(op: StructuredOperation): PromptEvaluatorDef[] {
  return RULES[op](op).map(({ impl, ...r }) => ({
    ...r,
    operation: op,
    phoenixName: `${STRUCTURED_PROMPTS[op].name}-${r.name.replaceAll("_", "-")}`,
    run: (p: EvalParams) => impl(p, r.config as never),
  }));
}
