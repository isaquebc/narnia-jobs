import { z } from "zod";

/**
 * F04/M5 · avaliadores determinísticos (sem tokens) das conversas de referência do recrutador em `evals/chat/`.
 * Cobrem as regras da persona: usar as tools em vez de supor, citar fonte, perguntar e pedir confirmação, mandar
 * ingestões para a revisão e não inventar datas que não estão no cartão do perfil.
 */
export const GRADER_TYPES = [
  "uses_tool",
  "cites_source",
  "asks_question",
  "asks_confirmation",
  "mentions_review",
  "no_unknown_years",
] as const;

const GraderSchema = z.object({ type: z.enum(GRADER_TYPES), value: z.string().optional() });
export type Grader = z.infer<typeof GraderSchema>;

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["career", "ingest", "clarify"]).default("career"),
  messages: z.array(z.string().min(1)).min(1),
  graders: z.array(GraderSchema).min(1),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export interface Transcript {
  /** Respostas do recrutador, em ordem. */
  replies: string[];
  /** Nomes publicados das tools chamadas na conversa. */
  tools: string[];
  /** Texto do cartão do perfil usado na conversa (fonte de verdade das datas). */
  card: string;
}

export interface GradeResult {
  type: Grader["type"];
  passed: boolean;
  detail: string;
}

export function parseEvalCases(jsonl: string): EvalCase[] {
  return jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => EvalCaseSchema.parse(JSON.parse(l)));
}

const years = (text: string) => [...new Set(text.match(/\b(19|20)\d{2}\b/g) ?? [])];

export function gradeTranscript(t: Transcript, graders: Grader[]): GradeResult[] {
  const all = t.replies.join("\n");
  return graders.map((g): GradeResult => {
    switch (g.type) {
      case "uses_tool": {
        const passed = t.tools.includes(g.value ?? "");
        return {
          type: g.type,
          passed,
          detail: passed
            ? `usou ${g.value}`
            : `não usou ${g.value}; usou: ${t.tools.join(", ") || "nenhuma"}`,
        };
      }
      case "cites_source": {
        const passed = /fonte|https?:\/\/|\b[a-z0-9-]+\.(gov|org|com)(\.br)?\b/i.test(all);
        return { type: g.type, passed, detail: passed ? "cita fonte" : "nenhuma fonte citada" };
      }
      case "asks_question": {
        const passed = all.includes("?");
        return {
          type: g.type,
          passed,
          detail: passed ? "faz pergunta" : "não pergunta nada ao usuário",
        };
      }
      case "asks_confirmation": {
        const passed =
          /\?/.test(all) && /confirm|aprova|posso|quer que|pode ser|de acordo/i.test(all);
        return {
          type: g.type,
          passed,
          detail: passed ? "pede confirmação" : "não pede confirmação antes de seguir",
        };
      }
      case "mentions_review": {
        const claimsWrite = /\b(gravei|salvei|atualizei)\b(?![^.]*sem você)/i.test(all);
        const passed = /revis/i.test(all) && !claimsWrite;
        return {
          type: g.type,
          passed,
          detail: passed
            ? "manda para a revisão"
            : "não menciona a revisão ou afirma ter gravado direto",
        };
      }
      case "no_unknown_years": {
        const known = new Set(years(t.card));
        const unknown = years(all).filter((y) => !known.has(y));
        return {
          type: g.type,
          passed: unknown.length === 0,
          detail:
            unknown.length === 0
              ? "sem anos fora do cartão"
              : `anos fora do cartão: ${unknown.join(", ")}`,
        };
      }
      default:
        throw new Error(`Avaliador desconhecido: ${String((g as { type: unknown }).type)}`);
    }
  });
}
