import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import { IdSchema, IsoDateTimeSchema, SenioritySchema } from "../schemas/common";
import { EmphasisItemSchema } from "../schemas/emphasis";
import { DocLocaleSchema } from "../schemas/persona";
import { GoalSchema } from "../schemas/profile";

/**
 * Tools MCP `profile.*` (F02 §2.8): aqui só a definição (schemas de entrada e saída). Os handlers puros vivem em
 * `packages/core/src/profile/tools.ts`; a exposição pelo servidor MCP HTTP é F04.
 */
export interface ToolDefinition<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  description: string;
  input: I;
  output: O;
}

const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

export const PROFILE_TOOLS = {
  "profile.list": tool(
    "Lista os perfis do usuário (nome, cargo-alvo, ativo); arquivados só com includeArchived.",
    z.object({ includeArchived: z.boolean().optional() }),
    z.object({
      profiles: z.array(
        z.object({
          id: IdSchema,
          name: z.string(),
          targetTitle: z.string(),
          isActive: z.boolean(),
          archived: z.boolean(),
        }),
      ),
    }),
  ),
  "profile.get_card": tool(
    "Devolve o cartão (~300 tokens) do perfil informado ou do ativo; reconstrói se estiver desatualizado.",
    z.object({ profileId: IdSchema.optional() }),
    z.object({
      profileId: IdSchema,
      text: z.string(),
      tokensEst: z.number().int().min(0),
      hash: z.string(),
      builtAt: IsoDateTimeSchema,
    }),
  ),
  "profile.switch": tool(
    "Torna o perfil informado o ativo (mesmo efeito do seletor do shell). Falha se o perfil está arquivado.",
    z.object({ profileId: IdSchema }),
    z.object({ ok: z.literal(true) }),
  ),
  "profile.update_emphasis": tool(
    "Substitui em lote as ênfases do perfil (destacar/normal/ocultar e ordem) e invalida o cartão.",
    z.object({ profileId: IdSchema, items: z.array(EmphasisItemSchema) }),
    z.object({ updated: z.number().int().min(0) }),
  ),
  "profile.update_pitch": tool(
    "Grava a narrativa (pitch) do perfil e invalida o cartão.",
    z.object({ profileId: IdSchema, pitch: z.string().max(2_000) }),
    z.object({ ok: z.literal(true) }),
  ),
  "profile.create": tool(
    "Cria um perfil (lente) novo; com cloneFrom copia ênfases, pitch e persona. Dados de carreira ficam pendentes (needsResearch) até o usuário preencher.",
    z.object({
      name: z.string().min(1),
      targetTitle: z.string().min(1),
      seniority: SenioritySchema,
      area: z.string().min(1),
      goal: GoalSchema,
      market: z.string().min(2),
      docLocale: DocLocaleSchema,
      cloneFrom: IdSchema.optional(),
    }),
    z.object({ id: IdSchema }),
  ),
} as const;

export type ProfileToolName = keyof typeof PROFILE_TOOLS;
export type ProfileToolInput<N extends ProfileToolName> = z.infer<
  (typeof PROFILE_TOOLS)[N]["input"]
>;
export type ProfileToolOutput<N extends ProfileToolName> = z.infer<
  (typeof PROFILE_TOOLS)[N]["output"]
>;

/** JSON Schema (draft-07, sem `$schema`) de cada tool, para o servidor MCP e para o snapshot de estabilidade. */
export const PROFILE_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(PROFILE_TOOLS) as ProfileToolName[]).map((name) => [
    name,
    {
      description: PROFILE_TOOLS[name].description,
      input: toJsonSchema(PROFILE_TOOLS[name].input),
      output: toJsonSchema(PROFILE_TOOLS[name].output),
    },
  ]),
) as Record<
  ProfileToolName,
  { description: string; input: Record<string, unknown>; output: Record<string, unknown> }
>;
