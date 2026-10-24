import type {
  ApplicationAnswer,
  ApplicationAnswerOutput,
  ApplicationQuestion,
  ApplicationRoleplayOutput,
  CvLocale,
} from "@narnia-jobs/shared";

/**
 * Respostas sugeridas do formulário (F12/M4, §4.6-3). O Sonnet (`narnia-application-answer`) responde só o que é dele:
 * nunca consentimento, autodeclaração (F12-12), anexo nem campo óbvio (esses saem dos dados por código). A conferência
 * por código vale como a do CV: escolha só entre as opções da página, limite de caracteres respeitado, só origens que
 * existem no resumo; sem dado, a lacuna (o que falta), nunca uma resposta inventada.
 */

export const APPLICATION_ANSWER_TASK = "application.answer";

const NOT_FOR_MODEL = new Set(["consent", "self_declaration", "file"]);

export function answerableQuestions(questions: ApplicationQuestion[]): ApplicationQuestion[] {
  return questions.filter((q) => !q.profileField && !NOT_FOR_MODEL.has(q.kind));
}

/**
 * Pergunta aberta (F12-18): texto longo, ou texto curto que pede motivação ou apresentação ("why are you interested",
 * "por que você quer", "conte sobre você"). Escolha nunca é aberta: a resposta é uma opção da página.
 */
const OPEN =
  /(\bwhy\b|por ?qu[eê]|interess|motiva|excit|empolga|tell us|tell me|about yourself|sobre voc[eê]|conte|describe|descreva|fale sobre|what makes you|o que te (atrai|faz)|apresente-se)/i;

export function splitOpenQuestions(questions: ApplicationQuestion[]): {
  facts: ApplicationQuestion[];
  open: ApplicationQuestion[];
} {
  const isOpen = (q: ApplicationQuestion) =>
    q.kind === "long_text" || (q.kind === "short_text" && OPEN.test(q.question));
  return { facts: questions.filter((q) => !isOpen(q)), open: questions.filter(isOpen) };
}

const EN = /\b(the|you|your|do|are|have|what|why|how|with|of|to|and|years|experience|please)\b/gi;
const PT =
  /\b(você|voce|sua|seu|qual|quais|por que|com|de|para|anos|experiência|experiencia|tem|é)\b/gi;

/** Idioma do formulário pelas perguntas (a resposta sai nele). */
export function detectFormLocale(questions: ApplicationQuestion[]): CvLocale {
  const text = questions.map((q) => q.question).join(" ");
  const en = text.match(EN)?.length ?? 0;
  const pt = text.match(PT)?.length ?? 0;
  return en > pt ? "en-US" : "pt-BR";
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

const YES_NO = new Map([
  ["sim", "Sim"],
  ["nao", "Não"],
  ["yes", "Yes"],
  ["no", "No"],
]);

/** Corta no fim da última frase que cabe; sem frase inteira, na última palavra que cabe. */
export function fitToLimit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > max * 0.4) return cut.slice(0, sentence + 1).trim();
  if (/[.!?]$/.test(cut)) return cut.trim();
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

type Draft = Omit<ApplicationAnswer, "version" | "createdAt">;

export function assembleAnswers(
  questions: ApplicationQuestion[],
  output: ApplicationAnswerOutput,
  resolve: (shortId: string) => { kind: string; id: string } | null,
): Draft[] {
  const byId = new Map(output.answers.map((a) => [a.questionId, a]));
  return questions.map((q): Draft => {
    const a = byId.get(q.id);
    const base = { questionId: q.id, source: "model" as const, assumptions: [] };
    if (!a)
      return { ...base, answer: null, origins: [], gap: "O modelo não respondeu esta pergunta." };
    const origins = a.origins
      .map(resolve)
      .filter((o): o is { kind: string; id: string } => o !== null);
    let answer = a.answer?.trim() || null;
    let gap = a.gap?.trim() || null;
    if (answer && (q.kind === "choice" || q.kind === "multi_choice" || q.kind === "yes_no")) {
      const parts = q.kind === "multi_choice" ? answer.split(/\s*;\s*/) : [answer];
      const picked = parts.map((p) => {
        const n = norm(p);
        if (q.options.length)
          return q.options.find((o) => norm(o.label) === n || norm(o.value) === n)?.label ?? null;
        return q.kind === "yes_no" ? (YES_NO.get(n) ?? null) : p;
      });
      if (picked.some((p) => p === null)) {
        gap = `Resposta fora das opções da página: "${answer}".`;
        answer = null;
      } else answer = picked.join("; ");
    }
    if (answer && q.maxChars) answer = fitToLimit(answer, q.maxChars);
    if (!answer && !gap) gap = "Sem dados para responder.";
    return { ...base, answer, origins, gap: answer ? null : gap };
  });
}

/**
 * Rascunhos do roleplay (F12-18): o texto cabe no limite, as origens são conferidas como no redator e as suposições
 * vão limpas (no máximo 4) para a janela mostrar "Confira". Pergunta esquecida ou texto vazio vira lacuna.
 */
export function assembleRoleplay(
  questions: ApplicationQuestion[],
  output: ApplicationRoleplayOutput,
  resolve: (shortId: string) => { kind: string; id: string } | null,
): Draft[] {
  const byId = new Map(output.answers.map((a) => [a.questionId, a]));
  return questions.map((q): Draft => {
    const a = byId.get(q.id);
    const base = { questionId: q.id, source: "roleplay" as const };
    let answer = a?.answer?.trim() || null;
    if (answer && q.maxChars) answer = fitToLimit(answer, q.maxChars);
    if (!a || !answer)
      return {
        ...base,
        answer: null,
        origins: [],
        assumptions: [],
        gap: a?.gap?.trim() || "O roleplay não escreveu esta resposta.",
      };
    return {
      ...base,
      answer,
      origins: a.origins.map(resolve).filter((o): o is { kind: string; id: string } => o !== null),
      assumptions: a.assumptions
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 4),
      gap: null,
    };
  });
}
