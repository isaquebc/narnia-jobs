import type { ProfileRecord } from "../../src/lib/api";

/** Perfil fictício mínimo (campos obrigatórios do ProfileSchema) para testes de componentes do F02. */
export function profile(id: string, partial: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id,
    userId: "u1",
    name: id,
    targetTitle: `Alvo ${id}`,
    altTitles: [],
    seniority: "senior",
    area: "software",
    goal: "new_job",
    market: "BR",
    docLocale: "pt-BR",
    salaryBelowReference: false,
    contractTypes: [],
    locations: [],
    needsResearch: [],
    isActive: false,
    archivedAt: null,
    clonedFrom: null,
    cardUpdatedAt: null,
    cardFactsVersion: null,
    ...partial,
  };
}
