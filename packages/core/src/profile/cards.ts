import { nowUtc, type ProfileCard, ProfileCardSchema } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { ProfileRecord } from "../db/repos/profiles";
import { buildProfileCard, type CardUser } from "./card";
import { ProfileError } from "./errors";
import { collectFactSets, scoreFacts } from "./relevance";

/**
 * Cache e validade do cartão (F02 §2.2, §2.9-2). Inválido = `card_updated_at` nulo ou `card_facts_version`
 * menor que `settings.facts_version`. Reconstrução preguiçosa em `getCard`, forçada em `rebuildCard`; a relevância
 * é recalculada e gravada junto. Quem emite o evento WS é a api, com `trackInvalidation`.
 */
export function parseCard(profile: Pick<ProfileRecord, "cardJson">): ProfileCard | null {
  if (!profile.cardJson) return null;
  try {
    const parsed = ProfileCardSchema.safeParse(JSON.parse(profile.cardJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isCardValid(
  profile: Pick<ProfileRecord, "cardJson" | "cardUpdatedAt" | "cardFactsVersion">,
  factsVersion: number,
): boolean {
  if (!profile.cardUpdatedAt) return false;
  if (profile.cardFactsVersion === null || profile.cardFactsVersion === undefined) return false;
  if (profile.cardFactsVersion < factsVersion) return false;
  return parseCard(profile) !== null;
}

const EMPTY_USER: CardUser = {
  fullName: null,
  displayName: null,
  city: null,
  country: null,
  remotePref: null,
};

function requireProfile(repos: Repos, profileId: string): ProfileRecord {
  const p = repos.profiles.get(profileId);
  if (!p) throw new ProfileError("profile_not_found", `Perfil não encontrado: ${profileId}`);
  return p;
}

/** Recalcula relevância e cartão e grava ambos, mesmo que o cartão esteja válido. */
export function rebuildCard(repos: Repos, profileId: string, now = new Date()): ProfileCard {
  const profile = requireProfile(repos, profileId);
  // a versão é lida antes de montar: uma escrita concorrente deixa o cartão inválido de novo
  const factsVersion = repos.settings.getFactsVersion();
  const facts = collectFactSets(repos);
  const emphasis = repos.emphasis.list(profileId);
  const relevance = scoreFacts(profile, facts, emphasis, now);
  repos.relevance.replaceForProfile(
    profileId,
    relevance.map((r) => ({
      factKind: r.factKind,
      factId: r.factId,
      score: r.score,
      reasons: r.reasons,
    })),
    nowUtc(),
  );
  const user = repos.users.get() ?? EMPTY_USER;
  const built = buildProfileCard(user, profile, facts, emphasis, relevance, now);
  const card: ProfileCard = { ...built, factsVersion, builtAt: nowUtc() };
  repos.profiles.setCard(profileId, card);
  return card;
}

/** Cartão do perfil, reconstruído quando inválido (leitura com efeito colateral, documentado em F02 §2.2). */
export function getCard(repos: Repos, profileId: string, now = new Date()): ProfileCard {
  const profile = requireProfile(repos, profileId);
  if (isCardValid(profile, repos.settings.getFactsVersion())) {
    return parseCard(profile) as ProfileCard;
  }
  return rebuildCard(repos, profileId, now);
}

/** Ids dos perfis não arquivados cujo cartão está válido agora (auditoria F02-6: arquivados ficam fora do evento). */
export function validProfileIds(repos: Repos): string[] {
  const version = repos.settings.getFactsVersion();
  return repos.profiles
    .list()
    .filter((p) => isCardValid(p, version))
    .map((p) => p.id);
}

/** Executa `fn` e devolve os perfis que estavam válidos antes e ficaram inválidos (F02 §2.9-2). */
export function trackInvalidation<T>(repos: Repos, fn: () => T): { result: T; flipped: string[] } {
  const before = validProfileIds(repos);
  const result = fn();
  const after = new Set(validProfileIds(repos));
  return { result, flipped: before.filter((id) => !after.has(id)) };
}

/** Invalida os cartões do usuário (hook explícito para escritas fora dos repos); devolve os que estavam válidos. */
export function invalidateUserCards(repos: Repos, userId = repos.users.ensureId()): string[] {
  return repos.profiles.invalidateCards(userId);
}
