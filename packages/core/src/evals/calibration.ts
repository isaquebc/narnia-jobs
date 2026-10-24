import { z } from "zod";
import type { PairPick } from "./pairwise";

/**
 * Calibração dos juízes (pedido do dono, 2026-10-24): respostas rotuladas à mão em `evals/calibration/*.jsonl`, limpas
 * e com defeitos de propósito, para medir se o juiz do padrão de entrega e o pairwise acertam antes de confiar neles
 * no gate. Absoluto: o rótulo esperado (`atende`, `parcial`, `nao_atende`). Par: a resposta melhor e a pior do mesmo
 * caso; a melhor tem de ganhar nas duas ordens.
 */
const AnswerSchema = z.object({ replies: z.array(z.string()).min(1), tools: z.array(z.string()) });
const LabelSchema = z.enum(["atende", "parcial", "nao_atende"]);
export type JudgeLabel = z.infer<typeof LabelSchema>;

const ItemSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("absolute"),
    /** Caso de `evals/chat` de onde vêm as mensagens da pessoa e a categoria. */
    case: z.string().min(1),
    defect: z.string().min(1),
    why: z.string().optional(),
    expect: LabelSchema,
    ...AnswerSchema.shape,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("pair"),
    case: z.string().min(1),
    defect: z.string().min(1),
    why: z.string().optional(),
    better: AnswerSchema,
    worse: AnswerSchema,
  }),
]);
export type CalibrationItem = z.infer<typeof ItemSchema>;

export function parseCalibrationItems(text: string): CalibrationItem[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => {
      const raw = JSON.parse(l) as { id?: unknown };
      const r = ItemSchema.safeParse(raw);
      if (!r.success)
        throw new Error(`Caso de calibração inválido (${String(raw.id)}): ${r.error.message}`);
      return r.data;
    });
}

export type CalibrationVerdict =
  | { id: string; kind: "absolute"; defect: string; expect: JudgeLabel; got: JudgeLabel }
  /** `first`: A = pior, B = melhor; `swapped`: A = melhor, B = pior. */
  | { id: string; kind: "pair"; defect: string; first: PairPick; swapped: PairPick };

export interface CalibrationMistake {
  id: string;
  defect: string;
  kind: "falso positivo" | "falso negativo" | "preferiu a pior" | "viés de posição" | "empate";
  /** Absoluto: errou por dois níveis (aprovou o que devia reprovar, ou o contrário). */
  severe: boolean;
  detail: string;
}

export interface CalibrationReport {
  absolute: { total: number; right: number; falsePositives: number; falseNegatives: number };
  pairs: { total: number; right: number; wrong: number; positionBias: number; ties: number };
  byDefect: Record<string, { total: number; right: number }>;
  mistakes: CalibrationMistake[];
}

const RANK: Record<JudgeLabel, number> = { nao_atende: 0, parcial: 1, atende: 2 };

export function scoreCalibration(verdicts: CalibrationVerdict[]): CalibrationReport {
  const r: CalibrationReport = {
    absolute: { total: 0, right: 0, falsePositives: 0, falseNegatives: 0 },
    pairs: { total: 0, right: 0, wrong: 0, positionBias: 0, ties: 0 },
    byDefect: {},
    mistakes: [],
  };
  for (const v of verdicts) {
    const d = r.byDefect[v.defect] ?? { total: 0, right: 0 };
    r.byDefect[v.defect] = d;
    d.total++;
    const miss = (kind: CalibrationMistake["kind"], severe: boolean, detail: string) =>
      r.mistakes.push({ id: v.id, defect: v.defect, kind, severe, detail });
    if (v.kind === "absolute") {
      r.absolute.total++;
      const diff = RANK[v.got] - RANK[v.expect];
      const detail = `esperado ${v.expect}, juiz deu ${v.got}`;
      if (diff === 0) {
        r.absolute.right++;
        d.right++;
      } else if (diff > 0) {
        r.absolute.falsePositives++;
        miss("falso positivo", diff > 1, detail);
      } else {
        r.absolute.falseNegatives++;
        miss("falso negativo", diff < -1, detail);
      }
      continue;
    }
    r.pairs.total++;
    const detail = `1ª ordem: ${v.first} (melhor em B) · 2ª ordem: ${v.swapped} (melhor em A)`;
    if (v.first === "B" && v.swapped === "A") {
      r.pairs.right++;
      d.right++;
    } else if (v.first === "A" && v.swapped === "B") {
      r.pairs.wrong++;
      miss("preferiu a pior", true, detail);
    } else if (v.first !== "empate" && v.swapped !== "empate") {
      // mesma letra nas duas ordens: escolheu pela posição, não pelo conteúdo
      r.pairs.positionBias++;
      miss("viés de posição", false, detail);
    } else {
      r.pairs.ties++;
      miss("empate", false, detail);
    }
  }
  return r;
}
