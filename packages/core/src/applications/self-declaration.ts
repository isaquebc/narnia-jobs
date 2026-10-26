import type { ApplicationQuestion } from "@narnia-jobs/shared";
import type { Repos } from "../db";

/**
 * Autodeclaração nos formulários (F12-12, F12-22): o que a pessoa declarou no chat vira a opção da página por código,
 * sem modelo. Só com uma opção que casa sem dúvida; ambíguo ou sem par, a pessoa decide no formulário. "Prefiro não
 * informar" é guardado como `PREFER_NOT` e só vira a opção equivalente da página, quando há.
 */
export const PREFER_NOT = "__prefiro_nao_informar__";

const PREFER_NOT_OPTION =
  /prefiro n[aã]o|n[aã]o (quero|desejo|gostaria de) (informar|responder|declarar|me identificar)|prefer not|rather not|decline|(do not|don'?t) wish|not to (say|disclose|answer)/i;

/** Sem acento, sem caixa e sem o gênero gramatical ("Pardo(a)" e "Parda" ficam iguais). */
function stem(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\((a|o|as|os)\)|\/(a|o)\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/[ao]s?$/, "") : w))
    .join(" ");
}

export function matchDeclarationOption(
  value: string,
  options: Array<{ value: string; label: string }>,
): string | null {
  if (value === PREFER_NOT)
    return options.find((o) => PREFER_NOT_OPTION.test(o.label))?.label ?? null;
  const target = stem(value);
  const hits = options.filter((o) => stem(o.label) === target || stem(o.value) === target);
  return hits.length === 1 ? (hits[0] as { label: string }).label : null;
}

/** Valor da pergunta de autodeclaração com o que a pessoa já declarou, ou nulo (ela decide no formulário). */
export function declarationAnswer(
  repos: Repos,
  q: Pick<ApplicationQuestion, "kind" | "topic" | "options">,
): string | null {
  if (q.kind !== "self_declaration" || !q.topic) return null;
  const d = repos.selfDeclarations.get(q.topic);
  if (!d) return null;
  if (q.options.length > 0) return matchDeclarationOption(d.value, q.options);
  return d.value === PREFER_NOT ? null : d.value;
}
