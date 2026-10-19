import type { CvLocale, CvSection } from "@narnia-jobs/shared";

/** Rótulos e datas do CV no idioma do documento (F05-16). */
const LABELS: Record<CvLocale, Record<CvSection, string> & { present: string; months: string[] }> =
  {
    "pt-BR": {
      summary: "Resumo",
      experience: "Experiência",
      skills: "Habilidades",
      projects: "Projetos",
      education: "Formação",
      languages: "Idiomas",
      present: "atual",
      months: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    },
    "en-US": {
      summary: "Summary",
      experience: "Experience",
      skills: "Skills",
      projects: "Projects",
      education: "Education",
      languages: "Languages",
      present: "Present",
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    },
  };

export const sectionLabel = (locale: CvLocale, s: CvSection) => LABELS[locale][s];

/** [pt-BR, en-US] dos idiomas mais comuns; a chave de busca ignora acento e caixa. */
const LANGUAGES: Array<[string, string]> = [
  ["Português", "Portuguese"],
  ["Inglês", "English"],
  ["Espanhol", "Spanish"],
  ["Francês", "French"],
  ["Alemão", "German"],
  ["Italiano", "Italian"],
  ["Holandês", "Dutch"],
  ["Russo", "Russian"],
  ["Polonês", "Polish"],
  ["Ucraniano", "Ukrainian"],
  ["Sueco", "Swedish"],
  ["Norueguês", "Norwegian"],
  ["Dinamarquês", "Danish"],
  ["Finlandês", "Finnish"],
  ["Grego", "Greek"],
  ["Turco", "Turkish"],
  ["Árabe", "Arabic"],
  ["Hebraico", "Hebrew"],
  ["Hindi", "Hindi"],
  ["Chinês", "Chinese"],
  ["Mandarim", "Mandarin"],
  ["Cantonês", "Cantonese"],
  ["Japonês", "Japanese"],
  ["Coreano", "Korean"],
  ["Libras", "Brazilian Sign Language"],
];
const languageKey = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
const LANGUAGE_INDEX = new Map(
  LANGUAGES.flatMap((pair) => pair.map((n) => [languageKey(n), pair] as const)),
);

/**
 * Nome do idioma no idioma do documento (dono, 2026-10-19: "Português (Native)" num CV em inglês reprovava em toda
 * tentativa, e o gerador não escreve essa seção). Desconhecido fica como nos dados.
 */
export function languageName(locale: CvLocale, name: string): string {
  const pair = LANGUAGE_INDEX.get(languageKey(name));
  if (!pair) return name;
  return locale === "pt-BR" ? pair[0] : pair[1];
}

/** Nível do idioma no CV: CEFR como está; "native" no idioma do documento. */
export function languageLevelLabel(locale: CvLocale, level: string): string {
  if (level !== "native") return level;
  return locale === "pt-BR" ? "nativo" : "Native";
}

/** YYYY, YYYY-MM ou YYYY-MM-DD → "mar 2021" / "Mar 2021" / "2021". */
export function formatPartialDate(locale: CvLocale, d: string): string {
  const [y, m] = d.split("-");
  if (!m) return y as string;
  return `${LABELS[locale].months[Number(m) - 1]} ${y}`;
}

/** Período: início – fim; sem fim = atual (experiência) ou só o ano de início. */
export function formatPeriod(
  locale: CvLocale,
  start: string | null,
  end: string | null,
  openEnded = true,
): string {
  if (!start && !end) return "";
  const s = start ? formatPartialDate(locale, start) : "";
  const e = end ? formatPartialDate(locale, end) : openEnded ? LABELS[locale].present : "";
  return [s, e].filter(Boolean).join(" – ");
}
