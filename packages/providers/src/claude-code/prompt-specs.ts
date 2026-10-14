import {
  AnalyzeProfilesOutputSchema,
  CHAT_OUTPUT_JSON_SCHEMAS,
  EXTRACTION_JSON_SCHEMAS,
  INGEST_OUTPUT_JSON_SCHEMAS,
  toJsonSchema,
} from "@narnia-jobs/shared";
import type {
  AnalyzeProfilesProviderInput,
  AnalyzeRepoInput,
  BuildDigestInput,
  ChatTitleInput,
  CheckProposalsInput,
  ExtractFactsInput,
  PickFilesInput,
  ReadDocumentInput,
  SynthesizeRunInput,
} from "../provider";
import { PROMPTS } from "./prompt-files";

/**
 * Fonte única dos prompts estruturados (avaliações no Phoenix, M2, decisão AV-4): system prompt (arquivo `.md`),
 * template da mensagem do usuário (variáveis `{{nome}}`, formato mustache do Phoenix), modelo padrão, schema da saída
 * e tools. O provider renderiza o template em cada chamada; a sincronização manda o mesmo template para o Phoenix.
 */
export type StructuredOperation = keyof typeof PROMPTS;

export interface StructuredPromptSpec {
  operation: StructuredOperation;
  /** Nome do prompt no Phoenix. */
  name: string;
  description: string;
  /** Arquivo do system prompt (relativo à raiz do repositório). */
  file: string;
  system: () => string;
  userTemplate: string;
  variables: string[];
  /** Modelo padrão da operação (decisões F01-5, F02-5, F03-5). */
  defaultModel: "haiku" | "sonnet";
  jsonSchema: Record<string, unknown>;
  /** Tools do Claude Code que a chamada usa (o Playground do Phoenix não executa tools). */
  tools: string[];
}

const FILE = (name: string) => `packages/providers/src/claude-code/prompts/${name}.md`;

const spec = (
  operation: StructuredOperation,
  s: Omit<StructuredPromptSpec, "operation" | "system" | "variables">,
): StructuredPromptSpec => ({
  operation,
  system: PROMPTS[operation],
  variables: [
    ...new Set([...s.userTemplate.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string)),
  ],
  ...s,
});

export const STRUCTURED_PROMPTS: Record<StructuredOperation, StructuredPromptSpec> = {
  readDocument: spec("readDocument", {
    name: "narnia-read-document",
    description: "Leitura 3 do PDF: o modelo lê o arquivo com a tool Read e transcreve (F01-3).",
    file: FILE("read-document"),
    userTemplate:
      'Leia o arquivo "{{file_name}}" (nesta pasta) com a ferramenta Read e transcreva todo o texto conforme as instruções. Idioma esperado: {{locale}}.',
    defaultModel: "haiku",
    jsonSchema: EXTRACTION_JSON_SCHEMAS.readDocument,
    tools: ["Read"],
  }),
  extractFacts: spec("extractFacts", {
    name: "narnia-extract-facts",
    description:
      "Fatos candidatos de um documento (identidade, experiências, formação, skills, idiomas, links).",
    file: FILE("extract-facts"),
    userTemplate: "Idioma do documento: {{locale}}.\n\n<documento>\n{{text}}\n</documento>",
    defaultModel: "haiku",
    jsonSchema: EXTRACTION_JSON_SCHEMAS.extractFacts,
    tools: [],
  }),
  buildDigest: spec("buildDigest", {
    name: "narnia-build-digest",
    description: "Registro de contexto do arquivo a partir do texto e dos fatos extraídos.",
    file: FILE("build-digest"),
    userTemplate:
      "Idioma do documento: {{locale}}.\n\n<documento>\n{{text}}\n</documento>\n\n<fatos_extraidos>\n{{proposals_json}}\n</fatos_extraidos>",
    defaultModel: "sonnet",
    jsonSchema: EXTRACTION_JSON_SCHEMAS.buildDigest,
    tools: [],
  }),
  analyzeProfiles: spec("analyzeProfiles", {
    name: "narnia-analyze-profiles",
    description: "Sugestões de perfil a partir de todo o histórico (F02-5).",
    file: FILE("analyze-profiles"),
    userTemplate: "<historico>\n{{history_json}}\n</historico>",
    defaultModel: "sonnet",
    jsonSchema: toJsonSchema(AnalyzeProfilesOutputSchema),
    tools: [],
  }),
  pickFiles: spec("pickFiles", {
    name: "narnia-pick-files",
    description:
      "GitHub (análise profunda): escolha dos arquivos que valem leitura em um repositório.",
    file: FILE("pick-files"),
    userTemplate:
      "Repositório: {{repo}}. Escolha no máximo {{max_files}} arquivos (maxFiles = {{max_files}}).\n\n<candidatos>\n{{candidates}}\n</candidatos>\n\n<arvore>\n{{tree}}\n</arvore>",
    defaultModel: "haiku",
    jsonSchema: INGEST_OUTPUT_JSON_SCHEMAS.pickFiles,
    tools: [],
  }),
  analyzeRepo: spec("analyzeRepo", {
    name: "narnia-analyze-repo",
    description:
      "GitHub: propostas, relatório e cobertura de um repositório a partir do contexto empacotado.",
    file: FILE("analyze-repo"),
    userTemplate: "Repositório: {{repo}}.\n\n<contexto>\n{{context}}\n</contexto>",
    defaultModel: "haiku",
    jsonSchema: INGEST_OUTPUT_JSON_SCHEMAS.analyzeRepo,
    tools: [],
  }),
  synthesizeRun: spec("synthesizeRun", {
    name: "narnia-synthesize-run",
    description: "GitHub: síntese da execução a partir dos relatórios e da tabela de métricas.",
    file: FILE("synthesize-run"),
    userTemplate:
      "<relatorios>\n{{reports}}\n</relatorios>\n\n<metricas>\n{{metrics_table}}\n</metricas>",
    defaultModel: "sonnet",
    jsonSchema: INGEST_OUTPUT_JSON_SCHEMAS.synthesizeRun,
    tools: [],
  }),
  checkProposals: spec("checkProposals", {
    name: "narnia-check-proposals",
    description: "Revisão anti-alucinação, camada 2: cada afirmação julgada só pelo trecho citado.",
    file: FILE("check-proposals"),
    userTemplate: "<itens>\n{{items_json}}\n</itens>",
    defaultModel: "haiku",
    jsonSchema: INGEST_OUTPUT_JSON_SCHEMAS.checkProposals,
    tools: [],
  }),
  chatTitle: spec("chatTitle", {
    name: "narnia-chat-title",
    description: "Título da conversa do chat a partir da primeira mensagem (modelo mais barato).",
    file: FILE("chat-title"),
    userTemplate: "<mensagem>\n{{message}}\n</mensagem>",
    defaultModel: "haiku",
    jsonSchema: CHAT_OUTPUT_JSON_SCHEMAS.chatTitle,
    tools: [],
  }),
};

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Variáveis do template a partir da entrada de cada operação (o mesmo cálculo para o app e para os datasets). */
export const structuredPromptVars = {
  readDocument: (i: ReadDocumentInput) => ({ file_name: basename(i.filePath), locale: i.locale }),
  extractFacts: (i: ExtractFactsInput) => ({ locale: i.locale, text: i.text }),
  buildDigest: (i: BuildDigestInput) => ({
    locale: i.locale,
    text: i.text,
    proposals_json: JSON.stringify(i.proposals),
  }),
  analyzeProfiles: (i: AnalyzeProfilesProviderInput) => {
    const { model: _model, ...history } = i;
    return { history_json: JSON.stringify(history, null, 1) };
  },
  pickFiles: (i: PickFilesInput) => ({
    repo: i.repo,
    max_files: String(i.maxFiles),
    candidates: i.candidates.join("\n"),
    tree: i.tree.join("\n"),
  }),
  analyzeRepo: (i: AnalyzeRepoInput) => ({ repo: i.repo, context: i.context }),
  synthesizeRun: (i: SynthesizeRunInput) => ({
    reports: i.reports
      .map((r) => `## ${r.fullName}\n${JSON.stringify(r.report, null, 1)}`)
      .join("\n\n"),
    metrics_table: i.metricsTable,
  }),
  checkProposals: (i: CheckProposalsInput) => ({ items_json: JSON.stringify(i.items, null, 1) }),
  chatTitle: (i: ChatTitleInput) => ({ message: i.message }),
} satisfies Record<StructuredOperation, (input: never) => Record<string, string>>;

/** Troca `{{nome}}` pelas variáveis numa passada só (conteúdo com chaves não é reinterpretado). */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`Variável sem valor no prompt: ${name}`);
    return v;
  });
}

/** Mensagem do usuário de uma operação estruturada, pronta para o modelo. */
export function renderStructuredPrompt<Op extends StructuredOperation>(
  op: Op,
  input: Parameters<(typeof structuredPromptVars)[Op]>[0],
): string {
  const vars = (structuredPromptVars[op] as (i: typeof input) => Record<string, string>)(input);
  return renderTemplate(STRUCTURED_PROMPTS[op].userTemplate, vars);
}
