import {
  PROFILE_TOOLS,
  type ProfileToolInput,
  type ProfileToolName,
  type ProfileToolOutput,
  RESEARCHABLE_FIELDS,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { getCard } from "./cards";
import { ProfileError } from "./errors";

/**
 * Handlers puros das tools MCP `profile.*` (F02 §2.8): recebem `Repos`, validam entrada e saída pelos schemas de
 * `packages/shared/src/mcp/profile.ts`. A exposição pelo servidor MCP HTTP é F04.
 */
export const PROFILE_TOOL_NAMES = Object.keys(PROFILE_TOOLS) as ProfileToolName[];

export type ProfileToolHandlers = {
  [N in ProfileToolName]: (input: unknown) => ProfileToolOutput<N>;
};

const ALL_RESEARCH = [...RESEARCHABLE_FIELDS];

function activeOrThrow(repos: Repos) {
  const active = repos.profiles.active();
  if (!active) throw new ProfileError("profile_not_found", "Nenhum perfil ativo");
  return active;
}

/**
 * `sessionProfileId` (chat do app, auditoria A): as tools agem só no perfil da conversa; outro `profileId` é recusado
 * e a ausência dele vale o da sessão, não o perfil ativo (que o usuário pode ter trocado em outra tela).
 */
export function createProfileTools(
  repos: Repos,
  opts: { sessionProfileId?: string | null } = {},
): ProfileToolHandlers {
  const bound = opts.sessionProfileId ?? null;
  const own = (profileId: string | undefined): string => {
    if (!bound) return profileId ?? activeOrThrow(repos).id;
    if (profileId && profileId !== bound)
      throw new ProfileError(
        "profile_not_in_session",
        "Esta conversa só pode ler ou alterar o próprio perfil. Para outro perfil, abra uma conversa nele.",
      );
    return bound;
  };
  const wrap = <N extends ProfileToolName>(
    name: N,
    impl: (input: ProfileToolInput<N>) => ProfileToolOutput<N>,
  ) => {
    const def = PROFILE_TOOLS[name];
    return (raw: unknown): ProfileToolOutput<N> =>
      def.output.parse(impl(def.input.parse(raw) as ProfileToolInput<N>)) as ProfileToolOutput<N>;
  };

  return {
    "profile.list": wrap("profile.list", (input) => ({
      profiles: repos.profiles
        .list({ includeArchived: input.includeArchived ?? false })
        .map((p) => ({
          id: p.id,
          name: p.name,
          targetTitle: p.targetTitle,
          isActive: p.isActive,
          archived: Boolean(p.archivedAt),
        })),
    })),
    "profile.get_card": wrap("profile.get_card", (input) => {
      const profileId = own(input.profileId);
      const card = getCard(repos, profileId);
      return {
        profileId,
        text: card.text,
        tokensEst: card.tokensEst,
        hash: card.hash,
        builtAt: card.builtAt,
      };
    }),
    "profile.switch": wrap("profile.switch", (input) => {
      repos.profiles.setActive(input.profileId);
      return { ok: true as const };
    }),
    "profile.update_emphasis": wrap("profile.update_emphasis", (input) => ({
      updated: repos.emphasis.replace(own(input.profileId), input.items).updated,
    })),
    "profile.update_pitch": wrap("profile.update_pitch", (input) => {
      repos.profiles.update(own(input.profileId), { pitch: input.pitch });
      return { ok: true as const };
    }),
    "profile.create": wrap("profile.create", (input) => {
      const { cloneFrom, ...data } = input;
      // sem UI (F02-8): carreira fica toda pendente até o usuário preencher
      const base = { ...data, altTitles: [], needsResearch: ALL_RESEARCH };
      const created = cloneFrom
        ? repos.profiles.clone(cloneFrom, base)
        : repos.profiles.create({ ...base, userId: repos.users.ensureId(), isActive: false });
      return { id: created.id };
    }),
  };
}
