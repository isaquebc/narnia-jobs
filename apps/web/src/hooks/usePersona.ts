import type { PersonaOverrides } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../app/context";
import { profileKey } from "./useProfiles";

export const personaKey = (id: string) => [...profileKey(id), "persona"] as const;

/** Persona do recrutador (F02 §2.4): derivada + overrides; `null` num campo restaura o padrão. */
export function usePersona(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: personaKey(id), queryFn: () => api.getPersona(id) });
  const save = useMutation({
    mutationFn: (overrides: PersonaOverrides) => api.putPersona(id, overrides),
    onSuccess: (data) => {
      qc.setQueryData(personaKey(id), data);
      void qc.invalidateQueries({ queryKey: [...profileKey(id), "card"] });
    },
  });
  return { ...query, save };
}
