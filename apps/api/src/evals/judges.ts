import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STRUCTURED_PROMPTS, type StructuredOperation } from "@narnia-jobs/providers";
import { MODEL_IDS } from "./prompt-catalog";

/**
 * Juízes do padrão de entrega (M4): um avaliador com modelo por prompt estruturado, preso ao dataset dele no Phoenix.
 * O texto fica em `evals/judges/<prompt>.md` (versionado no repositório); aqui só o mapeamento das variáveis (caminhos
 * do contexto do Phoenix: `input`, `output`, `reference`) e o formato que o Phoenix exige (classificação por tool).
 */
export const JUDGE_NAME = "padrao_de_entrega";
export const JUDGE_LABELS = [
  { label: "atende", score: 1 },
  { label: "parcial", score: 0.5 },
  { label: "nao_atende", score: 0 },
] as const;

const OUTPUT = "output.messages[0].content";

const VARIABLES: Record<StructuredOperation, Record<string, string>> = {
  readDocument: { referencia: "reference", resposta: OUTPUT },
  extractFacts: { fonte: "input.text", perfil: "input.experiences_json", resposta: OUTPUT },
  buildDigest: { fonte: "input.text", resposta: OUTPUT },
  analyzeProfiles: { historico: "input.history_json", resposta: OUTPUT },
  pickFiles: {
    repo: "input.repo",
    max_files: "input.max_files",
    arvore: "input.tree",
    resposta: OUTPUT,
  },
  analyzeRepo: { fonte: "input.context", resposta: OUTPUT },
  synthesizeRun: { relatorios: "input.reports", metricas: "input.metrics_table", resposta: OUTPUT },
  checkProposals: { itens: "input.items_json", referencia: "reference", resposta: OUTPUT },
  chatTitle: { mensagem: "input.message", resposta: OUTPUT },
};

export const JUDGE_SYSTEM =
  "Você é um avaliador rigoroso e justo do narnia-jobs. Julgue só pelo que está na mensagem, sem conhecimento externo, e responda chamando a ferramenta de avaliação com o rótulo e uma explicação curta em português.";

export interface JudgeDef {
  /** Prompt estruturado, ou "chat" para o juiz do recrutador. */
  operation: StructuredOperation | "chat";
  name: typeof JUDGE_NAME;
  description: string;
  file: string;
  body: string;
  variables: Record<string, string>;
  modelName: string;
  hash: string;
}

const repoRoot = () => fileURLToPath(new URL("../../../../", import.meta.url));

function judge(
  operation: JudgeDef["operation"],
  promptName: string,
  variables: Record<string, string>,
): JudgeDef {
  const file = `evals/judges/${promptName}.md`;
  const body = readFileSync(`${repoRoot()}${file}`, "utf8").trim();
  const description = `Padrão de entrega do prompt ${promptName} (juiz com modelo; texto em ${file}).`;
  const modelName = MODEL_IDS.sonnet;
  const hash = createHash("sha256")
    .update(
      JSON.stringify({ SYSTEM: JUDGE_SYSTEM, body, variables, modelName, labels: JUDGE_LABELS }),
    )
    .digest("hex");
  return { operation, name: JUDGE_NAME, description, file, body, variables, modelName, hash };
}

export function judgeFor(op: StructuredOperation): JudgeDef {
  return judge(op, STRUCTURED_PROMPTS[op].name, VARIABLES[op]);
}

/**
 * Juiz do recrutador (M5): avalia as conversas de referência (dataset `narnia-chat`), rodadas no sandbox isolado. No
 * contexto do Phoenix, `input.messages` são as mensagens da pessoa e `output` traz respostas e ferramentas usadas.
 */
export function chatJudge(): JudgeDef {
  return judge("chat", "narnia-recrutador", {
    contexto: "input.context",
    conversa: "input.messages",
    respostas: "output.replies",
    ferramentas: "output.tools",
  });
}

/** Versão do prompt do juiz no formato do Phoenix (avaliador LLM: classificação por tool, escolha obrigatória). */
export function judgePromptVersion(j: JudgeDef, customProviderId: string | null) {
  return {
    description: j.description,
    metadata: { hash: j.hash, source: j.file },
    templateFormat: "MUSTACHE",
    template: {
      messages: [
        { role: "SYSTEM", content: [{ text: { text: JUDGE_SYSTEM } }] },
        { role: "USER", content: [{ text: { text: j.body } }] },
      ],
    },
    invocationParameters: { anthropic: { maxTokens: 2000 } },
    modelProvider: "ANTHROPIC",
    modelName: j.modelName,
    ...(customProviderId ? { customProviderId } : {}),
    tools: {
      toolChoice: { oneOrMore: true },
      tools: [
        {
          function: {
            name: JUDGE_NAME,
            description: j.description,
            parameters: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  enum: JUDGE_LABELS.map((l) => l.label),
                  description: JUDGE_NAME,
                },
                explanation: {
                  type: "string",
                  description: "Por que esse rótulo, citando o ponto do padrão que falhou.",
                },
              },
              required: ["label", "explanation"],
            },
          },
        },
      ],
    },
  };
}

export const judgeOutputConfig = (j: JudgeDef) => [
  {
    categorical: {
      name: JUDGE_NAME,
      description: j.description,
      optimizationDirection: "MAXIMIZE",
      values: JUDGE_LABELS.map((l) => ({ label: l.label, score: l.score })),
    },
  },
];
