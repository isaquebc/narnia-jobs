import type { CvLocale, CvSection } from "@narnia-jobs/shared";

/** Nomes das seções como saem no PDF (os mesmos rótulos do template, no idioma do documento). */
const NAMES: Record<CvLocale, Record<CvSection, string>> = {
  "pt-BR": {
    summary: "Resumo",
    experience: "Experiência",
    skills: "Habilidades",
    projects: "Projetos",
    education: "Formação",
    languages: "Idiomas",
  },
  "en-US": {
    summary: "Summary",
    experience: "Experience",
    skills: "Skills",
    projects: "Projects",
    education: "Education",
    languages: "Languages",
  },
};

export const sectionNames = (locale: CvLocale) => NAMES[locale];
