import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { t } from "../i18n";

interface FormGuard {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  /** Pergunta antes de sair quando há alterações não salvas; `true` libera (e limpa o estado). */
  canLeave: () => boolean;
}

const FormGuardContext = createContext<FormGuard | null>(null);

/** Formulário sujo nunca é perdido por uma troca de perfil (F02 §2.5): o seletor consulta `canLeave()`. */
export function FormGuardProvider({
  children,
  confirm = (message) => window.confirm(message),
}: {
  children: ReactNode;
  confirm?: (message: string) => boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const canLeave = useCallback(() => {
    if (!dirty) return true;
    const ok = confirm(t("profiles.unsavedConfirm"));
    if (ok) setDirty(false);
    return ok;
  }, [dirty, confirm]);
  const value = useMemo(() => ({ dirty, setDirty, canLeave }), [dirty, canLeave]);
  return <FormGuardContext.Provider value={value}>{children}</FormGuardContext.Provider>;
}

const NEVER_DIRTY: FormGuard = { dirty: false, setDirty: () => {}, canLeave: () => true };

export function useFormGuard(): FormGuard {
  return useContext(FormGuardContext) ?? NEVER_DIRTY;
}
