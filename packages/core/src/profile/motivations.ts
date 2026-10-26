import type { AddressForm, MotivationStatus, ProfileMotivationsOutput } from "@narnia-jobs/shared";
import type { Repos } from "../db";

/**
 * Motivações do perfil (F12-23, pedido do dono 2026-10-26): o que move a pessoa vira configuração por perfil, sugerida
 * pelo histórico antes das respostas do formulário e decidida por ela. O tratamento segue o cadastro.
 */
export const PROFILE_MOTIVATIONS_TASK = "profile.motivations";
export const MOTIVATION_MAX_CHARS = 140;
/** Frases sugeridas de uma vez quando o perfil ainda não tem nenhuma. */
export const MOTIVATION_SUGGESTIONS = 4;

/** Revisado: a pessoa aceitou ao menos uma frase ou seguiu sem nenhuma (marcado no perfil). */
export function motivationsReviewed(repos: Repos, profileId: string): boolean {
  if (repos.profileMotivations.reviewedAt(profileId)) return true;
  return repos.profileMotivations.list(profileId).some((m) => m.status === "accepted");
}

/** Comparação sem caixa, acento, pontuação nem espaço repetido. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Conferência das frases do modelo: tira vazias, longas e repetidas (entre si e com as já guardadas, aceitas ou
 * recusadas: a recusada não volta) e limita a quantidade.
 */
export function assembleMotivations(
  output: ProfileMotivationsOutput,
  existing: Array<{ text: string; status: MotivationStatus }>,
  limit: number,
): string[] {
  const seen = new Set(existing.map((m) => norm(m.text)));
  const out: string[] = [];
  for (const m of output.motivations) {
    const text = m.text.replace(/\s+/g, " ").trim();
    const key = norm(text);
    if (!key || text.length > MOTIVATION_MAX_CHARS || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/** `pronouns` do cadastro → tratamento; sem escolha ou valor desconhecido, neutro (nunca deduzido do nome). */
export function addressForm(pronouns: string | null | undefined): AddressForm {
  const p = (pronouns ?? "").trim().toLowerCase();
  if (/^(feminino|ela\b|she\b)/.test(p)) return "feminino";
  if (/^(masculino|ele\b|he\b)/.test(p)) return "masculino";
  return "neutro";
}

/** Também usada pela janela (a caixa de editar a suposição já vem em primeira pessoa). */
export { assumptionAsMotivation } from "@narnia-jobs/shared";
