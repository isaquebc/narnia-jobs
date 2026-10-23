import {
  AnalyzeProfilesOutputSchema,
  APPLICATION_OUTPUT_JSON_SCHEMAS,
  CHAT_OUTPUT_JSON_SCHEMAS,
  CV_OUTPUT_JSON_SCHEMAS,
  EXTRACTION_JSON_SCHEMAS,
  INGEST_OUTPUT_JSON_SCHEMAS,
  POSTING_OUTPUT_JSON_SCHEMAS,
  toJsonSchema,
} from "@narnia-jobs/shared";
import type {
  AnalyzeProfilesProviderInput,
  AnalyzeRepoInput,
  ApplicationAnswerInput,
  ApplicationLocateInput,
  BuildDigestInput,
  ChatTitleInput,
  CheckProposalsInput,
  CvGenerateInput,
  CvReviewInput,
  ExtractFactsInput,
  PickFilesInput,
  PostingDuplicateInput,
  PostingExtractInput,
  PostingMergeInput,
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
    userTemplate:
      "Idioma do documento: {{locale}}.\n\n<experiencias_no_perfil>\n{{experiences_json}}\n</experiencias_no_perfil>\n\n<documento>\n{{text}}\n</documento>",
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
  postingExtract: spec("postingExtract", {
    name: "narnia-posting-extract",
    description: "F06: campos e palavras-chave de uma vaga a partir do texto (modelo barato).",
    file: FILE("posting-extract"),
    userTemplate: "<vaga>\n{{text}}\n</vaga>",
    defaultModel: "haiku",
    jsonSchema: POSTING_OUTPUT_JSON_SCHEMAS.postingExtract,
    tools: [],
  }),
  postingMerge: spec("postingMerge", {
    name: "narnia-posting-merge",
    description:
      "F06-6: junta a heurística local e a extração do modelo, com a origem de cada campo.",
    file: FILE("posting-merge"),
    userTemplate:
      "<vaga>\n{{text}}\n</vaga>\n\n<heuristica>\n{{heuristic_json}}\n</heuristica>\n\n<modelo>\n{{model_json}}\n</modelo>",
    defaultModel: "haiku",
    jsonSchema: POSTING_OUTPUT_JSON_SCHEMAS.postingMerge,
    tools: [],
  }),
  postingDuplicate: spec("postingDuplicate", {
    name: "narnia-posting-duplicate",
    description: "F06-9: as duas vagas com o mesmo hash são a mesma? Certeza e diferenças.",
    file: FILE("posting-duplicate"),
    userTemplate:
      "<vaga_salva>\n{{saved_json}}\n</vaga_salva>\n\n<vaga_nova>\n{{incoming_json}}\n</vaga_nova>",
    defaultModel: "haiku",
    jsonSchema: POSTING_OUTPUT_JSON_SCHEMAS.postingDuplicate,
    tools: [],
  }),
  applicationLocate: spec("applicationLocate", {
    name: "narnia-application-locate",
    description:
      "F12/M3: organiza os campos lidos do formulário de candidatura em perguntas (junta rótulos quebrados, marca consentimento e autodeclaração, descarta navegação).",
    file: FILE("application-locate"),
    userTemplate: "<pagina>\n{{page_json}}\n</pagina>\n\n<campos>\n{{fields_json}}\n</campos>",
    defaultModel: "haiku",
    jsonSchema: APPLICATION_OUTPUT_JSON_SCHEMAS.applicationLocate,
    tools: [],
  }),
  applicationAnswer: spec("applicationAnswer", {
    name: "narnia-application-answer",
    description:
      "F12/M4: respostas sugeridas do formulário de candidatura a partir do resumo do CV e dos dados da pessoa, com origem ou lacuna (nada inventado).",
    file: FILE("application-answer"),
    userTemplate:
      "<locale>{{locale}}</locale>\n\n<resumo>\n{{brief_json}}\n</resumo>\n\n<pessoa>\n{{person_json}}\n</pessoa>\n\n<perguntas>\n{{questions_json}}\n</perguntas>",
    defaultModel: "sonnet",
    jsonSchema: APPLICATION_OUTPUT_JSON_SCHEMAS.applicationAnswer,
    tools: [],
  }),
  cvGenerate: spec("cvGenerate", {
    name: "narnia-cv-generate",
    description:
      "F05: conteúdo do CV (bullets com origem, skills, resumo) a partir do resumo montado pelo código.",
    file: FILE("cv-generate"),
    userTemplate: "<resumo>\n{{brief_json}}\n</resumo>",
    defaultModel: "sonnet",
    jsonSchema: CV_OUTPUT_JSON_SCHEMAS.cvGenerate,
    tools: [],
  }),
  coverLetterGenerate: spec("coverLetterGenerate", {
    name: "narnia-cover-letter-generate",
    description:
      "F05-21: carta de apresentação com o que a pessoa cobre, as lacunas e a abertura para aprender.",
    file: FILE("cover-letter-generate"),
    userTemplate: "<resumo>\n{{brief_json}}\n</resumo>",
    defaultModel: "sonnet",
    jsonSchema: CV_OUTPUT_JSON_SCHEMAS.coverLetterGenerate,
    tools: [],
  }),
  cvReview: spec("cvReview", {
    name: "narnia-cv-review",
    description:
      "F05-13: revisão do CV ou da carta pelas imagens das páginas (tool Read) e pelo texto do PDF (modelo barato).",
    file: FILE("cv-review"),
    userTemplate:
      "Páginas do documento (imagens nesta pasta; leia cada uma com a ferramenta Read): {{page_files}}\n\n<dados>\n{{brief_json}}\n</dados>\n\n<conteudo>\n{{content_json}}\n</conteudo>\n\n<texto_do_pdf>\n{{pdf_text}}\n</texto_do_pdf>\n\n<checagens_do_sistema>\n{{checks_json}}\n</checagens_do_sistema>",
    defaultModel: "haiku",
    jsonSchema: CV_OUTPUT_JSON_SCHEMAS.cvReview,
    tools: ["Read"],
  }),
};

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Variáveis do template a partir da entrada de cada operação (o mesmo cálculo para o app e para os datasets). */
export const structuredPromptVars = {
  readDocument: (i: ReadDocumentInput) => ({ file_name: basename(i.filePath), locale: i.locale }),
  extractFacts: (i: ExtractFactsInput) => ({
    locale: i.locale,
    text: i.text,
    experiences_json: JSON.stringify(i.experiences ?? []),
  }),
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
  postingExtract: (i: PostingExtractInput) => ({ text: i.text }),
  postingMerge: (i: PostingMergeInput) => ({
    text: i.text,
    heuristic_json: JSON.stringify(i.heuristic, null, 1),
    model_json: JSON.stringify(i.extracted, null, 1),
  }),
  postingDuplicate: (i: PostingDuplicateInput) => ({
    saved_json: JSON.stringify(i.saved, null, 1),
    incoming_json: JSON.stringify(i.incoming, null, 1),
  }),
  applicationLocate: (i: ApplicationLocateInput) => ({
    page_json: JSON.stringify(i.page, null, 1),
    // compacto: sem os nulos e sem o valor das opções (o modelo só precisa do texto)
    fields_json: JSON.stringify(
      i.fields.map((f) =>
        Object.fromEntries(
          Object.entries({ ...f, options: f.options.map((o) => o.label) }).filter(
            ([, v]) => v !== null && v !== false && !(Array.isArray(v) && v.length === 0),
          ),
        ),
      ),
      null,
      1,
    ),
  }),
  applicationAnswer: (i: ApplicationAnswerInput) => ({
    locale: i.locale,
    brief_json: JSON.stringify(i.brief, null, 1),
    person_json: JSON.stringify(i.person, null, 1),
    questions_json: JSON.stringify(i.questions, null, 1),
  }),
  cvGenerate: (i: CvGenerateInput) => ({ brief_json: JSON.stringify(i.brief, null, 1) }),
  coverLetterGenerate: (i: CvGenerateInput) => ({ brief_json: JSON.stringify(i.brief, null, 1) }),
  cvReview: (i: CvReviewInput) => ({
    page_files: i.pageFiles.join(", ") || "(sem imagens: carta em texto)",
    brief_json: JSON.stringify(i.brief, null, 1),
    content_json: JSON.stringify(i.content, null, 1),
    pdf_text: i.pdfText,
    checks_json: JSON.stringify(i.checks, null, 1),
  }),
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
