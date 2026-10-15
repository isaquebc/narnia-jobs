import { createHash } from "node:crypto";
import { POSTING_IDENTITY_FIELDS, type PostingFields } from "@narnia-jobs/shared";

/**
 * Identidade da vaga (F06-2, F06-9): empresa + cliente + cargo + role, sem a data de publicação. Caixa, acentos,
 * pontuação e espaços não contam ("Itaú Unibanco S.A." = "itau unibanco sa"). Sem empresa nem cargo/role não há
 * identidade (null): a vaga ainda não tem dados para comparar.
 */
export function normalizeIdentityPart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function postingIdentityHash(
  fields: {
    [K in (typeof POSTING_IDENTITY_FIELDS)[number]]?: PostingFields[K] | undefined;
  },
): string | null {
  const company = normalizeIdentityPart(fields.company);
  if (!company || !(fields.title || fields.role)) return null;
  const parts = POSTING_IDENTITY_FIELDS.map((k) => `${k}=${normalizeIdentityPart(fields[k])}`);
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
