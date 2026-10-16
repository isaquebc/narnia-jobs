import type { CvHeader, CvLocale } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { formatPhone } from "../phone";
import { buildHeaderLinks } from "./links";

/** Cabeçalho do CV pelos dados da pessoa (nunca pelo modelo): nome, cargo-alvo, cidade, contato e links (F05-19). */
export function buildCvHeader(repos: Repos, profileId: string, locale: CvLocale): CvHeader {
  const user = repos.users.get();
  const profile = repos.profiles.get(profileId);
  const owners = repos.repos.list().map((r) => r.owner);
  const githubOwner =
    owners.sort(
      (a, b) => owners.filter((o) => o === b).length - owners.filter((o) => o === a).length,
    )[0] ?? null;
  let phone: string | null = null;
  if (user?.phone?.e164)
    try {
      phone = formatPhone(user.phone.e164, locale);
    } catch {
      phone = user.phone.e164;
    }
  const place = [user?.city, user?.region].filter(Boolean).join(", ");
  return {
    name: user?.fullName ?? user?.displayName ?? profile?.name ?? "",
    title: profile?.targetTitle ?? "",
    location: place || user?.country || null,
    email: user?.email ?? null,
    phone,
    links: buildHeaderLinks(
      { email: user?.email ?? null, phone: user?.phone ?? null, links: user?.links ?? [] },
      { githubOwner },
    ),
  };
}
