import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { STRUCTURED_PROMPTS } from "@narnia-jobs/providers";
import { pluginDir, readPluginFile, splitFrontmatter } from "../plugin";

/**
 * Catálogo dos prompts do narnia-jobs para o Phoenix (M2, decisão AV-4): o repositório é a fonte; cada entrada vira um
 * prompt versionado no Phoenix. São 19: as 9 chamadas estruturadas (system + template da mensagem), a persona do
 * recrutador, as 4 notas de contexto do chat e as 5 skills do terminal. O hash cobre tudo o que muda a resposta do
 * modelo (mensagens, modelo, schema, tools): hash igual = mesma versão.
 */
export type PromptKind = "structured" | "agent" | "note" | "skill";

export interface PromptDef {
  name: string;
  kind: PromptKind;
  description: string;
  /** Arquivos de origem (relativos à raiz do repositório). */
  sources: string[];
  messages: Array<{ role: "SYSTEM" | "USER"; content: string }>;
  modelName: string;
  jsonSchema: Record<string, unknown> | null;
  /** Nome da saída estruturada no Phoenix (`response_format.json_schema.name`). */
  schemaName: string | null;
  tools: string[];
  variables: string[];
  hash: string;
}

/** Apelidos do app → ids da API (o Playground com chave de API não entende apelidos; a ponte aceita os dois). */
export const MODEL_IDS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;

/** Mensagem genérica do usuário nos prompts de conversa (persona e skills). */
const USER_MESSAGE = "{{mensagem}}";

const variablesOf = (texts: string[]) => [
  ...new Set(texts.flatMap((t) => [...t.matchAll(/\{\{([\w.]+)\}\}/g)].map((m) => m[1] as string))),
];

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function def(p: Omit<PromptDef, "hash" | "variables">): PromptDef {
  const variables = variablesOf(p.messages.map((m) => m.content));
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        messages: p.messages,
        modelName: p.modelName,
        jsonSchema: p.jsonSchema,
        tools: p.tools,
      }),
    )
    .digest("hex");
  return { ...p, variables, hash };
}

export function promptCatalog(dir = pluginDir()): PromptDef[] {
  const structured = Object.values(STRUCTURED_PROMPTS).map((s) =>
    def({
      name: s.name,
      kind: "structured",
      description: s.description,
      sources: [s.file, "packages/providers/src/claude-code/prompt-specs.ts"],
      messages: [
        { role: "SYSTEM", content: s.system() },
        { role: "USER", content: s.userTemplate },
      ],
      modelName: MODEL_IDS[s.defaultModel],
      jsonSchema: s.jsonSchema,
      schemaName: snake(s.operation),
      tools: s.tools,
    }),
  );
  const agentFile = splitFrontmatter(readPluginFile("agents/recrutador.md", dir));
  const agentTools = /^tools:\s*(.+)$/m.exec(agentFile.frontmatter)?.[1] ?? "";
  const agent = def({
    name: "narnia-recrutador",
    kind: "agent",
    description:
      "Persona do recrutador (system prompt do chat e agente do terminal), com o cartão do perfil.",
    sources: ["plugin/agents/recrutador.md"],
    messages: [
      { role: "SYSTEM", content: agentFile.body.trim() },
      { role: "USER", content: USER_MESSAGE },
    ],
    modelName: MODEL_IDS.sonnet,
    jsonSchema: null,
    schemaName: null,
    tools: agentTools
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  });
  const notes = readdirSync(join(dir, "prompts"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) =>
      def({
        name: `narnia-nota-${f.replace(/\.md$/, "")}`,
        kind: "note",
        description:
          "Nota de contexto que o chat antepõe à mensagem do usuário (ou parte do agente do terminal).",
        sources: [`plugin/prompts/${f}`],
        messages: [{ role: "USER", content: readPluginFile(`prompts/${f}`, dir).trim() }],
        modelName: MODEL_IDS.sonnet,
        jsonSchema: null,
        schemaName: null,
        tools: [],
      }),
    );
  const skills = readdirSync(join(dir, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const file = splitFrontmatter(readPluginFile(`skills/${name}/SKILL.md`, dir));
      const description = /^description:\s*(.+)$/m.exec(file.frontmatter)?.[1]?.trim() ?? name;
      return def({
        name: `narnia-skill-${name}`,
        kind: "skill",
        description,
        sources: [`plugin/skills/${name}/SKILL.md`],
        messages: [
          { role: "SYSTEM", content: file.body.trim() },
          { role: "USER", content: USER_MESSAGE },
        ],
        modelName: MODEL_IDS.sonnet,
        jsonSchema: null,
        schemaName: null,
        tools: ["mcp__narnia-jobs__*"],
      });
    });
  return [...structured, agent, ...notes, ...skills];
}
