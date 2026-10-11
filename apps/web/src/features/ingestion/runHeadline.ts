import { type TKey, t } from "../../i18n";

/** Chave do dicionário para uma etapa (tarefas e etapas usam "." no nome; o dicionário usa "_"). */
export const stepKey = (key: string) => `timeline.step.${key.replace(/\./g, "_")}` as TKey;

export interface RunProgressLike {
  current: number | null;
  total: number;
  stepKey: string | null;
  stuck: boolean;
}

const ACTIVE = new Set(["estimating", "queued", "running"]);

/**
 * Frase do status da execução (plano de comunicação C1/C2): em andamento nunca aparece só "Analisando"; diz a etapa
 * ("Analisando · etapa 5 de 6: Conferir as propostas") ou que parece parada. Usada na página, na lista e na bandeja.
 */
export function runHeadline(status: string, progress?: RunProgressLike | null): string {
  if (ACTIVE.has(status) && progress?.current && progress.stepKey) {
    return t(progress.stuck ? "run.headline.stuck" : "run.headline.running", {
      current: progress.current,
      total: progress.total,
      step: t(stepKey(progress.stepKey)),
    });
  }
  return t(`run.status.${status}` as TKey);
}
