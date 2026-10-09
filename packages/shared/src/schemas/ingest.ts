import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** Execução de ingestão da F03 (§2, §3): fontes, estados, orçamento, diagnóstico do plano, relatório, revisão. */

export const IngestionSourceSchema = z.enum(["cv", "text", "github"]);
export type IngestionSource = z.infer<typeof IngestionSourceSchema>;

/** Análise do GitHub: pública (só repositórios públicos, sem login) ou privada (inclui privados; F03-2). */
export const IngestionModeSchema = z.enum(["public", "private"]);
export type IngestionMode = z.infer<typeof IngestionModeSchema>;

export const IngestionDepthSchema = z.enum(["quick", "balanced", "deep"]);
export type IngestionDepth = z.infer<typeof IngestionDepthSchema>;

/** Estados do F01 + confirmação de orçamento, decisão no freio (F03-3 §6), pausa ("deixar para depois") e cancelamento. */
export const RunStatusSchema = z.enum([
  "estimating",
  "queued",
  "running",
  "awaiting_confirmation",
  "awaiting_decision",
  "paused",
  "review",
  "done",
  "error",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Unidade de exibição do orçamento (F03-3 §1); o valor guardado é sempre em tokens. */
export const BudgetUnitSchema = z.enum(["thousand", "million", "window_pct"]);
export type BudgetUnit = z.infer<typeof BudgetUnitSchema>;

const Tokens = z.number().int().min(0);

/** Orçamento pedido na criação/estimativa: quantidade em tokens + unidade escolhida para exibir. */
export const BudgetRequestSchema = z.object({ amount: Tokens, unit: BudgetUnitSchema });
export type BudgetRequest = z.infer<typeof BudgetRequestSchema>;

/** Orçamento gravado no run: fatia igual por repositório, sem redistribuir sobra (F03-3 §2). */
export const BudgetSchema = BudgetRequestSchema.extend({
  depth: IngestionDepthSchema,
  perRepo: Tokens,
  reserve: z.object({ synthesis: Tokens, check: Tokens }),
});
export type Budget = z.infer<typeof BudgetSchema>;

const UsageWindowSchema = z.object({
  utilization: z.number().min(0).max(100).nullable(),
  resetsAt: IsoDateTimeSchema.nullable(),
});
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

/** Diagnóstico do plano (F03-3 §1): percentual das janelas; a Anthropic não publica o limite absoluto em tokens. */
export const PlanUsageSchema = z.object({
  subscription: z.string().nullable(),
  source: z.enum(["usage_api", "rate_limit_event"]),
  windows: z.object({
    fiveHour: UsageWindowSchema.nullable(),
    sevenDay: UsageWindowSchema.nullable(),
    perModel: z.array(UsageWindowSchema.extend({ model: z.string().min(1) })),
  }),
});
export type PlanUsage = z.infer<typeof PlanUsageSchema>;

export const RepoRunStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "skipped_budget",
  "error",
]);

/** Relatório da execução (F03-3 §2): estimado × real por repositório, paradas e o que ficou de fora. */
export const RunReportSchema = z.object({
  model: z.string().min(1),
  budget: Tokens,
  totals: z.object({ estimated: Tokens, used: Tokens }),
  repos: z.array(
    z.object({
      fullName: z.string().min(1),
      estimatedTokens: Tokens,
      usedTokens: Tokens,
      status: RepoRunStatusSchema,
      stoppedReason: z.string().optional(),
    }),
  ),
  stops: z.array(
    z.object({ at: IsoDateTimeSchema, reason: z.string().min(1), usedTokens: Tokens }),
  ),
  skipped: z.array(z.string()),
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  synthesis: z.string().nullable(),
});
export type RunReport = z.infer<typeof RunReportSchema>;

/** Trecho literal da fonte que sustenta uma proposta (F03-3 §8, F03-12). */
export const EvidenceSchema = z.object({
  ref: z.string().min(1).describe("Onde está o trecho: caminho do arquivo, 'README.md', 'cv'…"),
  quote: z.string().min(1).max(600).describe("Trecho copiado literalmente da fonte"),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Selo da revisão anti-alucinação: `unchecked` até a camada 2 rodar (ou com ela desligada). */
export const CheckStatusSchema = z.enum(["supported", "partial", "unsupported", "unchecked"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

/** Reconciliação com os fatos existentes (F03 §2.8). */
export const ProposalMatchSchema = z.enum(["new", "existing", "conflict"]);
export type ProposalMatch = z.infer<typeof ProposalMatchSchema>;

export const ConflictFieldSchema = z.object({
  field: z.string().min(1),
  current: z.unknown(),
  proposed: z.unknown(),
  currentSource: z.string().nullable(),
  proposedSource: z.string().nullable(),
});
export const ConflictSchema = z.object({
  targetId: IdSchema,
  fields: z.array(ConflictFieldSchema).min(1),
});
export type Conflict = z.infer<typeof ConflictSchema>;

/** Resolução de conflito campo a campo: manter o atual, usar o novo ou editar (F03-6). */
export const FieldResolutionSchema = z.object({
  choice: z.enum(["keep", "use_new", "edit"]),
  value: z.unknown().optional(),
});
export const ResolutionSchema = z.record(z.string().min(1), FieldResolutionSchema);
export type Resolution = z.infer<typeof ResolutionSchema>;
