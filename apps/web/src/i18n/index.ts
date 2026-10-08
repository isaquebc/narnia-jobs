import { createTranslator, type DictionaryPath } from "@narnia-jobs/shared";
import { ptBR } from "./pt-BR";

export type TKey = DictionaryPath<typeof ptBR>;
export const t = createTranslator(ptBR, {
  onMissing: (key) => {
    if (import.meta.env?.DEV) console.warn(`[i18n] chave ausente: ${key}`);
  },
});
export { ptBR };
