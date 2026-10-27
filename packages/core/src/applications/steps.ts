import type { ApplicationQuestion, FormField } from "@narnia-jobs/shared";

/**
 * Formulário em várias etapas (F12/M6, §4.3): o clique numa etapa nova entra no mesmo formulário em vez de criar outro.
 * Cada etapa guarda o que a extensão leu nela; as perguntas guardam o número da etapa e ids próprios (a etapa 1 mantém
 * `q1…`, de antes das etapas), então organizar uma etapa nunca mexe nas respostas das outras.
 */
export interface FormStep {
  n: number;
  url: string;
  title: string | null;
  fields: FormField[];
  status: "locating" | "ready" | "error";
  createdAt: string;
}

const norm = (s: string | null) =>
  (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Os campos pelo tipo e pelo rótulo (a referência `fN` é só a posição; o valor digitado nunca sai da página). */
const signature = (fields: FormField[]) =>
  fields.map((f) => `${f.control}:${norm(f.label ?? f.placeholder ?? f.name)}`).join("|");

const page = (url: string) => url.split("#")[0];

/**
 * A etapa já lida que esta página repete: mesmo endereço (sem a âncora) e os mesmos campos. Formulário de página única
 * (Workday, Gupy) troca os campos sem trocar o endereço, então endereço igual com campos novos é etapa nova.
 */
export function matchStep<T extends Pick<FormStep, "n" | "url" | "fields">>(
  steps: T[],
  read: { url: string; fields: FormField[] },
): T | null {
  const sig = signature(read.fields);
  return steps.find((s) => page(s.url) === page(read.url) && signature(s.fields) === sig) ?? null;
}

export const stepOf = (q: Pick<ApplicationQuestion, "step">) => q.step ?? 1;

/** Perguntas organizadas de uma etapa: o número dela e os ids (`q1…` na 1, `s2q1…` nas outras). */
export function stepQuestions(questions: ApplicationQuestion[], n: number): ApplicationQuestion[] {
  return questions.map((q, i) => ({ ...q, id: n === 1 ? `q${i + 1}` : `s${n}q${i + 1}`, step: n }));
}

/** Troca as perguntas da etapa `n` pelas novas, mantendo as outras e a ordem das etapas. */
export function mergeStepQuestions(
  all: ApplicationQuestion[],
  n: number,
  fresh: ApplicationQuestion[],
): ApplicationQuestion[] {
  const kept = all.filter((q) => stepOf(q) !== n);
  // estável: dentro da etapa, a ordem da página
  return [...kept, ...fresh].sort((a, b) => stepOf(a) - stepOf(b));
}
