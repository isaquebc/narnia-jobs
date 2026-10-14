import type { FactProposal, ProposalReference, RunOrigin } from "@narnia-jobs/shared";
import { type TKey, t } from "../../i18n";

/**
 * Onde o card entra no perfil (pedido do dono, 2026-10-14): na hora de aprovar, cada item diz se é informação pessoal,
 * qual experiência (e se ela é do perfil ou nova desta ingestão), formação, skill, idioma ou projeto.
 */
export function referenceText(
  p: FactProposal,
  ref: ProposalReference | null | undefined,
  match: "new" | "existing" | "conflict" = "new",
): string {
  const label = ref?.existing ?? null;
  switch (p.kind) {
    case "identity":
      return t("review3.ref.identity");
    case "link":
      return t("review3.ref.link");
    case "experience":
      return label
        ? t(
            match === "conflict"
              ? "review3.ref.experienceUpdate"
              : "review3.ref.experienceExisting",
            {
              label,
            },
          )
        : t("review3.ref.experienceNew");
    case "achievement": {
      const e = ref?.experience;
      if (!e) return t("review3.ref.achievementNone");
      return t(e.source === "run" ? "review3.ref.achievementRun" : "review3.ref.achievement", {
        label: e.label,
      });
    }
    case "education":
      return label ? t("review3.ref.educationExisting", { label }) : t("review3.ref.educationNew");
    case "skill": {
      const category = t(`review3.skillCategory.${p.data.category}` as TKey);
      return label
        ? t("review3.ref.skillExisting", { category, label })
        : t("review3.ref.skillNew", { category });
    }
    case "language":
      return label ? t("review3.ref.languageExisting", { label }) : t("review3.ref.languageNew");
    case "project":
      return label ? t("review3.ref.projectExisting", { label }) : t("review3.ref.projectNew");
    default:
      return "";
  }
}

/** De onde veio a ingestão: arquivo, começo do texto ou repositórios, e a conversa que abriu. */
export function originText(
  source: string | undefined,
  origin: RunOrigin | null | undefined,
): string {
  const base =
    source === "text"
      ? origin?.excerpt
        ? t("review3.origin.text", { excerpt: origin.excerpt })
        : t("review3.origin.textNoExcerpt")
      : source === "github"
        ? t("review3.origin.github", { name: origin?.name ?? "" })
        : origin?.name
          ? t("review3.origin.cv", { name: origin.name })
          : t("review3.origin.cvNoName");
  return origin?.chatTitle
    ? `${base} · ${t("review3.origin.chat", { title: origin.chatTitle })}`
    : base;
}
